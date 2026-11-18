const { createProductsService } = require('../../../src/modules/products/service');

describe('product search is accent-insensitive', () => {
  it('adds a folded LIKE so "thep" can match "Thép"', async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [{ total: 0 }] };
      }),
      release: jest.fn()
    };
    const service = createProductsService({ database: { connect: async () => client } });
    await service.listProducts('company-1', { search: 'Thép', view: 'summary' }).catch(() => {});
    const listQuery = queries.find((q) => /translate\(lower\(p\.name\)/.test(q.sql));
    expect(listQuery).toBeDefined();
    expect(listQuery.params).toContain('%Thép%');
    expect(listQuery.params).toContain('%thep%');
  });
});
