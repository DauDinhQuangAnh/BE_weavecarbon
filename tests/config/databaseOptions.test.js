const { buildDatabasePoolConfig } = require('../../src/config/databaseOptions');

describe('database pool limits and timeouts', () => {
  test('uses bounded production defaults', () => {
    expect(buildDatabasePoolConfig({ NODE_ENV: 'production' })).toMatchObject({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      query_timeout: 20000,
      keepAlive: true
    });
  });

  test('bounds unsafe environment overrides', () => {
    const config = buildDatabasePoolConfig({
      DB_POOL_MAX: '10000',
      DB_IDLE_TIMEOUT_MS: '1',
      DB_CONNECT_TIMEOUT_MS: '999999',
      DB_STATEMENT_TIMEOUT_MS: '0',
      DB_QUERY_TIMEOUT_MS: '25000'
    });
    expect(config.max).toBe(100);
    expect(config.idleTimeoutMillis).toBe(1000);
    expect(config.connectionTimeoutMillis).toBe(60000);
    expect(config.statement_timeout).toBe(1000);
    expect(config.query_timeout).toBe(25000);
  });
});
