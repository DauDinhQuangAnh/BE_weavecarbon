const {
  createVerificationRepository
} = require('../../../src/modules/auth/verificationRepository');

describe('auth verification repository', () => {
  test('marks email verification using a parameterized update', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createVerificationRepository();

    await repository.markEmailVerified('user-1', client);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('email_verified = true');
    expect(params).toEqual(['user-1']);
  });

  test('returns an existing company membership', async () => {
    const membership = { company_id: 'company-1', status: 'invited' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [membership] }) };
    const repository = createVerificationRepository();

    await expect(repository.findCompanyMembership('company-1', 'user-1', client))
      .resolves.toBe(membership);
    expect(client.query.mock.calls[0][1]).toEqual(['company-1', 'user-1']);
  });

  test('returns the activated membership directly', async () => {
    const membership = { company_id: 'company-1', status: 'active' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [membership] }) };
    const repository = createVerificationRepository();

    await expect(repository.activateCompanyMembership('company-1', 'user-1', client))
      .resolves.toBe(membership);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain("status = 'invited'");
  });

  test('falls back to the current membership when it is already active', async () => {
    const membership = { company_id: 'company-1', status: 'active' };
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [membership] })
    };
    const repository = createVerificationRepository();

    await expect(repository.activateCompanyMembership('company-1', 'user-1', client))
      .resolves.toBe(membership);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('updates both membership and user login timestamps', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = createVerificationRepository();

    await repository.markMembershipLoggedIn('company-1', 'user-1', client);
    await repository.markUserLoggedIn('user-1', client);
    expect(client.query.mock.calls[0][0]).toContain('last_login = NOW()');
    expect(client.query.mock.calls[0][1]).toEqual(['company-1', 'user-1']);
    expect(client.query.mock.calls[1][0]).toContain('last_login_at = NOW()');
    expect(client.query.mock.calls[1][1]).toEqual(['user-1']);
  });
});
