const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const { bootstrapApplication } = require('./bootstrap/appBootstrap');
const { SLOW_REQUEST_MS } = require('./config/runtime');
const { resolveAllowedFrontendOrigins, normalizeOrigin } = require('./config/urls');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { requestContext } = require('./middleware/requestContext');
const { apiLimiter } = require('./middleware/rateLimiter');
const { sendSuccess } = require('./utils/http');
const logger = require('./utils/logger');
const metrics = require('./operations/metrics');
const reportJobQueue = require('./services/reportJobQueue');
const pool = require('./config/database');
const swaggerSpec = require('./config/swagger');
const apiRoutes = require('./config/apiRoutes');

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = resolveAllowedFrontendOrigins();
const API_JSON_LIMIT = process.env.API_JSON_LIMIT || '1mb';

function createCorsOptions(frontendOrigins) {
  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizedOrigin && frontendOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-ID'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Correlation-ID'],
    maxAge: 86400
  };
}

function logStartup(port) {
  const environment = process.env.NODE_ENV || 'development';
  logger.info(`[weavecarbon-api] Running on port ${port} in ${environment} mode`);
}

function slowRequestLogger(req, res, next) {
  if (skipCompactAiAccessLog(req)) {
    return next();
  }

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs < SLOW_REQUEST_MS) {
      return;
    }

    logger.warn({
      correlationId: req.correlationId,
      method: req.method,
      path: safeMetricPath(req),
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(1))
    }, '[http] Slow request');
  });

  next();
}

function safeMetricPath(req) {
  return String(req.originalUrl || req.url || '')
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function structuredAccessLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const path = safeMetricPath(req);
    metrics.increment('weavecarbon_http_requests_total', {
      method: req.method,
      path,
      status: res.statusCode
    });
    if (!skipCompactAiAccessLog(req)) {
      logger.info({
        correlationId: req.correlationId,
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(1))
      }, '[http] Request completed');
    }
  });
  next();
}

function skipCompactAiAccessLog(req) {
  if (process.env.AI_HTTP_ACCESS_LOGS === 'verbose') {
    return false;
  }

  return req.originalUrl.startsWith('/api/chat') || req.originalUrl.startsWith('/api/ai-config/rag');
}

app.disable('x-powered-by');
app.use(helmet());
app.use(requestContext);
app.use(cors(createCorsOptions(allowedOrigins)));
app.use(structuredAccessLogger);
app.use(slowRequestLogger);
app.use(express.json({ limit: API_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: API_JSON_LIMIT, parameterLimit: 1000 }));

app.use('/api', apiLimiter);

app.get('/health', (req, res) => {
  sendSuccess(res, {
    data: { status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() }
  });
});

app.get('/ready', async (req, res) => {
  try {
    await startupReady;
    await pool.query('SELECT 1');
    if (!reportJobQueue.isReady()) throw new Error('Job worker is not ready');
    sendSuccess(res, {
      data: { status: 'ready', timestamp: new Date().toISOString(), db: 'ok', queue: 'ok' }
    });
  } catch {
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_NOT_READY', message: 'Database or background worker is not ready' }
    });
  }
});

app.get('/metrics', (req, res) => {
  metrics.setGauge('weavecarbon_db_pool_connections', { state: 'total' }, pool.totalCount);
  metrics.setGauge('weavecarbon_db_pool_connections', { state: 'idle' }, pool.idleCount);
  metrics.setGauge('weavecarbon_db_pool_connections', { state: 'waiting' }, pool.waitingCount);
  res.type('text/plain; version=0.0.4').send(metrics.render());
});

const apiDocsEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';
if (apiDocsEnabled) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

apiRoutes.forEach(({ basePath, router }) => {
  app.use(basePath, router);
});

app.use(notFound);
app.use(errorHandler);

let server = null;
const startupReady = bootstrapApplication();

if (require.main === module) {
  startupReady
    .then(() => {
      server = app.listen(PORT, () => {
        logStartup(PORT);
      });
    })
    .catch((error) => {
      logger.error({ err: error }, '[startup] Application bootstrap failed');
      process.exit(1);
    });
}

let shutdownPromise = null;
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  logger.info({ signal }, '[shutdown] Graceful shutdown started');

  if (!server) {
    shutdownPromise = reportJobQueue.stop().finally(() => process.exit(0));
    return shutdownPromise;
  }

  shutdownPromise = new Promise((resolve) => {
    server.close(resolve);
  }).then(async () => {
    const drained = await reportJobQueue.stop();
    await pool.end().catch((error) => logger.warn({ err: error }, '[shutdown] Database close failed'));
    logger.info({ drained }, '[shutdown] Graceful shutdown complete');
    process.exit(drained ? 0 : 1);
  });
  return shutdownPromise;
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '[fatal] Unhandled promise rejection');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, '[fatal] Uncaught exception');
  shutdown('uncaughtException');
});

app.startupReady = startupReady;

module.exports = app;
