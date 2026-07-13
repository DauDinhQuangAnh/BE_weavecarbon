const { Pool } = require('pg');
const { SLOW_REQUEST_MS } = require('./runtime');
const logger = require('../utils/logger');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

const CLIENT_QUERY_INSTRUMENTED = Symbol('clientQueryInstrumented');
const POOL_QUERY_INSTRUMENTED = Symbol('poolQueryInstrumented');

const summarizeSql = (text) => String(text || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200);

function logSlowQuery(source, text, durationMs) {
  if (durationMs < SLOW_REQUEST_MS) {
    return;
  }

  logger.warn(
    `[db:${source}] Slow query ${durationMs.toFixed(1)}ms :: ${summarizeSql(text)}`
  );
}

function instrumentQueryMethod(target, source) {
  if (!target || target[CLIENT_QUERY_INSTRUMENTED]) {
    return;
  }

  const originalQuery = target.query.bind(target);
  target.query = async (...args) => {
    const startedAt = process.hrtime.bigint();
    try {
      return await originalQuery(...args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const queryConfig = typeof args[0] === 'string' ? { text: args[0] } : (args[0] || {});
      logSlowQuery(source, queryConfig.text, durationMs);
    }
  };
  target[CLIENT_QUERY_INSTRUMENTED] = true;
}

if (!pool[POOL_QUERY_INSTRUMENTED]) {
  const originalPoolQuery = pool.query.bind(pool);
  pool.query = async (...args) => {
    const startedAt = process.hrtime.bigint();
    try {
      return await originalPoolQuery(...args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const queryConfig = typeof args[0] === 'string' ? { text: args[0] } : (args[0] || {});
      logSlowQuery('pool', queryConfig.text, durationMs);
    }
  };
  pool[POOL_QUERY_INSTRUMENTED] = true;
}

pool.on('connect', (client) => {
  instrumentQueryMethod(client, 'client');
});

pool.on('error', (err) => {
  logger.error({ err }, '[database] Unexpected database error');
  process.exit(-1);
});

module.exports = pool;
