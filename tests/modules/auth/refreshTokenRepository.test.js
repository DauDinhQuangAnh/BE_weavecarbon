const {
  createRefreshTokenRepository
} = require('../../../src/modules/auth/refreshTokenRepository');

describe('auth refresh token repository', () => {
  test('creates the refresh-token schema once for the shared pool', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createRefreshTokenRepository(pool);

    await repository.ensureSchema();
    await repository.ensureSchema();

    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(pool.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS');
  });

  test('commits successful work and releases the connection', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repository = createRefreshTokenRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async (transaction) => {
      expect(transaction).toBe(client);
      return 'done';
    })).resolves.toBe('done');
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('supports an explicit rollback without committing', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repository = createRefreshTokenRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async (_transaction, { rollback }) => {
      await rollback();
      return null;
    })).resolves.toBeNull();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back failed work and preserves the error', async () => {
    const failure = new Error('rotation failed');
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repository = createRefreshTokenRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('locks a rotatable session using the configured grace period', async () => {
    const session = { id: 'session-1', user_id: 'user-1' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [session] }) };
    const repository = createRefreshTokenRepository();

    await expect(repository.findRotatableByHash(client, 'token-hash', 45)).resolves.toBe(session);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("$2::int * INTERVAL '1 second'");
    expect(params).toEqual(['token-hash', 45]);
  });

  test('stores request metadata with parameterized SQL', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createRefreshTokenRepository();
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    await repository.insert(client, {
      userId: 'user-1',
      tokenHash: 'token-hash',
      expiresAt,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    });
    expect(client.query.mock.calls[0][1]).toEqual([
      'user-1', 'token-hash', expiresAt, '127.0.0.1', 'test-agent'
    ]);
  });
});
