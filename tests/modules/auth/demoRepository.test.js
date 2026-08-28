const {
  DEMO_QUERY_TIMEOUT_MS,
  createDemoRepository
} = require('../../../src/modules/auth/demoRepository');

describe('auth demo repository', () => {
  test('prepares schema before beginning the provisioning transaction', async () => {
    const events = [];
    const client = {
      query: jest.fn(async (query) => {
        events.push(typeof query === 'string' ? query : query.text);
        return { rows: [] };
      }),
      release: jest.fn(() => events.push('release'))
    };
    const repository = createDemoRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(
      async () => {
        events.push('work');
        return 'created';
      },
      { beforeTransaction: async () => events.push('prepare') }
    )).resolves.toBe('created');
    expect(events).toEqual(['prepare', 'BEGIN', 'work', 'COMMIT', 'release']);
  });

  test('rolls back and releases when demo provisioning fails', async () => {
    const failure = new Error('seed failed');
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    };
    const repository = createDemoRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([query]) => query)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('isolates optional B2B seed failure behind the established savepoint', async () => {
    const failure = new Error('optional data failed');
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createDemoRepository();

    await expect(repository.withB2BSeedSavepoint(client, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([query]) => query)).toEqual([
      'SAVEPOINT demo_b2b_seed',
      'ROLLBACK TO SAVEPOINT demo_b2b_seed',
      'RELEASE SAVEPOINT demo_b2b_seed'
    ]);
  });

  test('keeps standard demo subscription duration, limit and timeout', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createDemoRepository();

    await repository.initializeStandard(client, 'company-1', 20);

    const query = client.query.mock.calls[0][0];
    expect(query.text).toContain("NOW() + INTERVAL '30 days'");
    expect(query.text).toContain('standard_sku_limit = GREATEST');
    expect(query.values).toEqual(['company-1', 20]);
    expect(query.query_timeout).toBe(DEMO_QUERY_TIMEOUT_MS);
  });

  test('persists demo users with verified and expiring flags', async () => {
    const user = { id: 'user-1', email: 'demo@example.com' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [user] }) };
    const repository = createDemoRepository();
    const expiresAt = new Date('2026-08-29T00:00:00.000Z');

    await expect(repository.insertUser(client, {
      email: 'demo@example.com',
      passwordHash: 'hash',
      expiresAt
    })).resolves.toBe(user);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('email_verified');
    expect(sql).toContain('true, true, $4');
    expect(params).toEqual(['demo@example.com', 'hash', 'Demo User', expiresAt]);
  });
});
