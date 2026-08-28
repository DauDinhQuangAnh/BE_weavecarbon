const {
  createCompanyMembersRepository
} = require('../../../src/modules/organizations/companyMembersRepository');

describe('organizations company members repository', () => {
  test('commits successful transactions and always releases the connection', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    };
    const repository = createCompanyMembersRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async (transaction) => {
      expect(transaction).toBe(client);
      return 'done';
    })).resolves.toBe('done');

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back failed transactions and preserves the original error', async () => {
    const failure = new Error('write failed');
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    };
    const repository = createCompanyMembersRepository({
      connect: jest.fn().mockResolvedValue(client)
    });

    await expect(repository.withTransaction(async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('builds member filters with parameterized SQL', async () => {
    const rows = [{ id: 'member-1' }];
    const client = { query: jest.fn().mockResolvedValue({ rows }) };
    const repository = createCompanyMembersRepository();

    await expect(repository.listMembers(client, 'company-1', {
      status: 'active',
      role: 'member'
    })).resolves.toBe(rows);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('cm.company_id = $1');
    expect(sql).toContain('cm.status = $2');
    expect(sql).toContain('cm.role = $3');
    expect(params).toEqual(['company-1', 'active', 'member']);
  });

  test('updates only supplied fields with stable parameter positions', async () => {
    const updated = { id: 'member-1', role: 'viewer', status: 'disabled' };
    const client = { query: jest.fn().mockResolvedValue({ rows: [updated] }) };
    const repository = createCompanyMembersRepository();

    await expect(repository.updateMember(client, 'company-1', 'member-1', {
      role: 'viewer',
      status: 'disabled'
    })).resolves.toBe(updated);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('role = $1');
    expect(sql).toContain('status = $2');
    expect(sql).toContain('WHERE id = $3 AND company_id = $4');
    expect(params).toEqual(['viewer', 'disabled', 'member-1', 'company-1']);
  });
});
