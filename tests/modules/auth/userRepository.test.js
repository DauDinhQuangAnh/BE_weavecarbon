const {
  TRIAL_QUERY_TIMEOUT_MS,
  createUserRepository
} = require('../../../src/modules/auth/userRepository');

describe('auth user repository', () => {
  test('commits successful provisioning and releases the connection', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repository = createUserRepository({ connect: jest.fn().mockResolvedValue(client) });

    await expect(repository.withTransaction(async (transaction) => {
      expect(transaction).toBe(client);
      return 'created';
    })).resolves.toBe('created');
    expect(client.query.mock.calls.map(([query]) => query)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back failed provisioning and preserves the error', async () => {
    const failure = new Error('profile failed');
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const repository = createUserRepository({ connect: jest.fn().mockResolvedValue(client) });

    await expect(repository.withTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([query]) => query)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('keeps invited profiles in the supplied company', async () => {
    const profile = { id: 'profile-1', company_id: 'company-1' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [profile] }) };
    const repository = createUserRepository();

    await expect(repository.insertProfile(client, {
      userId: 'user-1',
      email: 'user@example.com',
      fullName: 'User',
      companyId: 'company-1'
    })).resolves.toBe(profile);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('user_id, email, full_name, company_id');
    expect(sql).toContain('VALUES ($1, $2, $3, $4, NOW(), NOW())');
    expect(params).toEqual(['user-1', 'user@example.com', 'User', 'company-1']);
  });

  test('initializes the trial with the existing query timeout', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createUserRepository();

    await repository.initializeTrial(client, 'company-1');
    const query = client.query.mock.calls[0][0];
    expect(query.text).toContain('INSERT INTO public.subscription_cycles');
    expect(query.values).toEqual(['company-1']);
    expect(query.query_timeout).toBe(TRIAL_QUERY_TIMEOUT_MS);
  });

  test('queries primary membership with inactive visibility as a parameter', async () => {
    const membership = { company_id: 'company-1', member_status: 'invited' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [membership] }) };
    const repository = createUserRepository();

    await expect(repository.findPrimaryCompanyMembership(client, 'user-1', true))
      .resolves.toBe(membership);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("CASE WHEN cm.status = 'active' THEN 0 ELSE 1 END");
    expect(params).toEqual(['user-1', true]);
  });

  test('creates an OAuth user without a password and preserves verification intent', async () => {
    const created = { id: 'user-1', email: 'user@example.com' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [created] }) };
    const repository = createUserRepository();

    await expect(repository.insertGoogleUser(client, {
      email: 'user@example.com',
      fullName: 'User',
      avatarUrl: 'https://example.com/avatar.png',
      markEmailVerified: true
    })).resolves.toBe(created);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('password_hash');
    expect(sql).toContain('CASE WHEN $5 THEN NOW() ELSE NULL END');
    expect(params).toEqual([
      'user@example.com',
      '',
      'User',
      'https://example.com/avatar.png',
      true
    ]);
  });

  test('updates OAuth identity data without reverting an existing verification', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createUserRepository();

    await repository.updateGoogleUser(client, {
      userId: 'user-1',
      avatarUrl: 'https://example.com/avatar.png',
      markEmailVerified: false
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('CASE WHEN $2 THEN true ELSE email_verified END');
    expect(params).toEqual(['https://example.com/avatar.png', false, 'user-1']);
  });

  test('loads the legacy profile company through the repository boundary', async () => {
    const company = { id: 'company-1', name: 'Example Co' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [company] }) };
    const repository = createUserRepository();

    await expect(repository.findCompanyById('company-1', client)).resolves.toBe(company);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('FROM companies');
    expect(params).toEqual(['company-1']);
  });
});
