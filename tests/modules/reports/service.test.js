jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/analytics', () => ({
  enqueueEvent: jest.fn(),
  queuePendingDispatch: jest.fn(),
  trackEvent: jest.fn()
}));
jest.mock('../../../src/modules/shared/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const { createReportsService } = require('../../../src/modules/reports');
const { createMockClient } = require('../../helpers/mockPool');

describe('ReportsService', () => {
  test('loads the active V2 template through the injected database port', async () => {
    const template = { id: 'template-id', version: '2.0' };
    const database = { query: jest.fn().mockResolvedValue({ rows: [template] }) };
    const service = createReportsService({ database });

    await expect(service.getActiveV2Template()).resolves.toBe(template);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('report_templates'));
  });

  test('keeps list filtering, safe sorting and pagination on the company boundary', async () => {
    const client = createMockClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'report-id',
        report_type: 'dataset_export',
        title: 'Audit export',
        status: 'completed',
        file_format: 'csv',
        records: 4
      }] });
    const database = { connect: jest.fn().mockResolvedValue(client) };
    const service = createReportsService({ database });

    const result = await service.listReports('company-id', {
      search: 'audit',
      status: 'completed',
      page: 2,
      page_size: 5,
      sort_by: 'unsafe_column',
      sort_order: 'asc'
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('r.company_id = $1'),
      ['company-id', '%audit%', 'completed']
    );
    expect(client.query.mock.calls[1][0]).toContain('ORDER BY r.created_at ASC');
    expect(client.query.mock.calls[1][1]).toEqual([
      'company-id', '%audit%', 'completed', 5, 5
    ]);
    expect(result.pagination).toEqual({ page: 2, page_size: 5, total: 1, total_pages: 1 });
    expect(result.items[0]).toEqual(expect.objectContaining({ id: 'report-id' }));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('releases a database connection when a report query fails', async () => {
    const client = createMockClient();
    const queryError = new Error('database unavailable');
    client.query.mockRejectedValue(queryError);
    const service = createReportsService({
      database: { connect: jest.fn().mockResolvedValue(client) }
    });

    await expect(service.getReportById('report-id', 'company-id')).rejects.toBe(queryError);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
