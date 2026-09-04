const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const { bootstrapApplication } = require('./bootstrap/appBootstrap');
const { SLOW_REQUEST_MS } = require('./config/runtime');
const { resolveAllowedFrontendOrigins, normalizeOrigin } = require('./config/urls');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { sendSuccess } = require('./utils/http');
const logger = require('./utils/logger');
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
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

    logger.warn(
      `[http] Slow request ${durationMs.toFixed(1)}ms :: ${req.method} ${String(req.originalUrl || '').split('?')[0]} -> ${res.statusCode}`
    );
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
app.use(cors(createCorsOptions(allowedOrigins)));
morgan.token('safe-url', (req) => String(req.originalUrl || req.url || '').split('?')[0]);
app.use(morgan('[http] :method :safe-url -> :status', { skip: skipCompactAiAccessLog }));
app.use(slowRequestLogger);
app.use(express.json({ limit: API_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: API_JSON_LIMIT, parameterLimit: 1000 }));

app.use('/api', apiLimiter);

app.get('/health', async (req, res) => {
  try {
    const pool = require('./config/database');
    await pool.query('SELECT 1');
    sendSuccess(res, {
      data: { status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), db: 'ok' }
    });
  } catch {
    res.status(503).json({ success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not reachable' } });
  }
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

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);

  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    process.exit(0);
  });
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
