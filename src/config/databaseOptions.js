function readBoundedInteger(env, name, fallback, min, max) {
  const parsed = Number.parseInt(env[name] || '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function buildDatabasePoolConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    application_name: env.DB_APPLICATION_NAME || 'weavecarbon-api',
    max: readBoundedInteger(env, 'DB_POOL_MAX', isProduction ? 10 : 20, 1, 100),
    idleTimeoutMillis: readBoundedInteger(env, 'DB_IDLE_TIMEOUT_MS', 30000, 1000, 300000),
    connectionTimeoutMillis: readBoundedInteger(env, 'DB_CONNECT_TIMEOUT_MS', 5000, 500, 60000),
    statement_timeout: readBoundedInteger(env, 'DB_STATEMENT_TIMEOUT_MS', 15000, 1000, 300000),
    query_timeout: readBoundedInteger(env, 'DB_QUERY_TIMEOUT_MS', 20000, 1000, 300000),
    keepAlive: true
  };
}

module.exports = { buildDatabasePoolConfig, readBoundedInteger };
