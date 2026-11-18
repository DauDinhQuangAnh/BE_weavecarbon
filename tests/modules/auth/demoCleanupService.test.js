const { createDemoCleanupService } = require('../../../src/modules/auth/demoCleanupService');

const makePool = ({ rows = [], failUserIds = [] } = {}) => {
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FROM users u')) return { rows };
      if (sql.startsWith('DELETE FROM users') && failUserIds.includes(params[0])) {
        throw new Error('violates foreign key constraint');
      }
      return { rows: [] };
    }),
    release: jest.fn()
  };
  return { pool: { connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [{ count: rows.length }] })) }, client, queries };
};

const log = { info: jest.fn(), warn: jest.fn() };

describe('demoCleanupService', () => {
  it('deletes only expired demo users, each in its own transaction', async () => {
    const { pool, client, queries } = makePool({ rows: [{ id: 'u1', company_id: null }, { id: 'u2', company_id: 'c2' }] });
    const service = createDemoCleanupService({ pool, log, now: () => new Date('2026-11-18T00:00:00Z') });
    const result = await service.purgeExpiredDemoUsers();
    expect(result).toEqual({ scanned: 2, deleted: 2, skipped: 0 });
    const select = queries.find((q) => q.sql.includes('FROM users u'));
    expect(select.sql).toContain('u.is_demo_user = true');
    expect(select.sql).toContain('u.demo_expires_at < $1');
    const userDeletes = queries.filter((q) => q.sql.startsWith('DELETE FROM users'));
    expect(userDeletes.every((q) => q.sql.includes('is_demo_user = true'))).toBe(true);
    const companyDelete = queries.find((q) => q.sql.startsWith('DELETE FROM companies'));
    expect(companyDelete.params).toEqual(['c2', 'u2']);
    expect(companyDelete.sql).toContain('NOT EXISTS');
    expect(queries.filter((q) => q.sql === 'COMMIT')).toHaveLength(2);
    expect(client.release).toHaveBeenCalled();
  });

  it('skips a user that cannot be deleted and continues with the batch', async () => {
    const { pool, queries } = makePool({ rows: [{ id: 'u1', company_id: null }, { id: 'u2', company_id: null }], failUserIds: ['u1'] });
    const service = createDemoCleanupService({ pool, log });
    const result = await service.purgeExpiredDemoUsers();
    expect(result).toEqual({ scanned: 2, deleted: 1, skipped: 1 });
    expect(queries.some((q) => q.sql === 'ROLLBACK')).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });

  it('scheduler timer does not keep the process alive and can be stopped', () => {
    jest.useFakeTimers();
    const { pool } = makePool();
    const service = createDemoCleanupService({ pool, log });
    const handle = service.startScheduler({ intervalMs: 1000 });
    jest.advanceTimersByTime(3000);
    expect(pool.connect).toHaveBeenCalledTimes(3);
    handle.stop();
    jest.advanceTimersByTime(3000);
    expect(pool.connect).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});
