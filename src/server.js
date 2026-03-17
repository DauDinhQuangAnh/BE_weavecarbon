const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { resolveAllowedFrontendOrigins, normalizeOrigin } = require('./config/urls');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { sendSuccess } = require('./utils/http');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const accountRoutes = require('./routes/account');
const subscriptionRoutes = require('./routes/subscription');
const companyMembersRoutes = require('./routes/companyMembers');
const reportsRoutes = require('./routes/reports');
const productsRoutes = require('./routes/products');
const batchesRoutes = require('./routes/batches');
const logisticsRoutes = require('./routes/logistics');
const exportMarketsRoutes = require('./routes/exportMarkets');
const chatRoutes = require('./routes/chat');
const aiConfigRoutes = require('./routes/aiConfig');

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = resolveAllowedFrontendOrigins();

const apiRoutes = [
  ['/api/auth', authRoutes],
  ['/api/dashboard', dashboardRoutes],
  ['/api/account', accountRoutes],
  ['/api/subscription', subscriptionRoutes],
  ['/api/company/members', companyMembersRoutes],
  ['/api/reports', reportsRoutes],
  ['/api/products', productsRoutes],
  ['/api/product-batches', batchesRoutes],
  ['/api/logistics', logisticsRoutes],
  ['/api/export/markets', exportMarketsRoutes],
  ['/api/chat', chatRoutes],
  ['/api/ai-config', aiConfigRoutes]
];

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
  console.log(`[weavecarbon-api] Running on port ${port} in ${environment} mode`);
}

app.disable('x-powered-by');
app.use(helmet());
app.use(cors(createCorsOptions(allowedOrigins)));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiLimiter);

app.get('/health', (req, res) => sendSuccess(res, {
  data: {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }
}));

apiRoutes.forEach(([basePath, routeHandler]) => {
  app.use(basePath, routeHandler);
});

app.use(notFound);
app.use(errorHandler);

let server = null;

if (require.main === module) {
  server = app.listen(PORT, () => {
    logStartup(PORT);
  });
}

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);

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

module.exports = app;
