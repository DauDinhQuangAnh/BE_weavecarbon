jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const { createReportJobQueue } = require('../../../src/modules/reports');

describe('ReportJobQueue', () => {
  test('maps persisted jobs to the unchanged worker task types', () => {
    const queue = createReportJobQueue();

    expect(queue._rowToTask({
      id: 'dataset-id',
      company_id: 'company-id',
      report_type: 'dataset_export',
      dataset_type: 'product',
      file_format: 'csv'
    })).toEqual({
      type: 'dataset_export',
      reportId: 'dataset-id',
      companyId: 'company-id',
      datasetType: 'product',
      fileFormat: 'csv'
    });

    expect(queue._rowToTask({
      id: 'compliance-id',
      company_id: 'company-id',
      report_type: 'compliance',
      file_format: 'csv'
    })).toEqual({
      type: 'market_compliance_report',
      reportId: 'compliance-id',
      companyId: 'company-id'
    });

    expect(queue._rowToTask({
      id: 'pdf-id',
      company_id: 'company-id',
      report_type: 'compliance',
      file_format: 'pdf'
    })).toEqual({
      type: 'manual_report',
      reportId: 'pdf-id',
      companyId: 'company-id'
    });
  });

  test('deduplicates pending jobs by type and report ID', () => {
    const queue = createReportJobQueue({
      loadReportsService: () => ({ _generateRealReport: jest.fn() })
    });
    const task = { type: 'manual_report', reportId: 'report-id', companyId: 'company-id' };

    expect(queue.enqueue(task)).toBe(true);
    expect(queue.enqueue(task)).toBe(false);
    expect(queue.pending).toHaveLength(1);
  });

  test('recovers unfinished rows once and dispatches them through the queue', async () => {
    const generateExport = jest.fn().mockResolvedValue(undefined);
    const database = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: 'report-id',
          company_id: 'company-id',
          report_type: 'dataset_export',
          dataset_type: 'audit',
          file_format: 'xlsx'
        }]
      })
    };
    const queue = createReportJobQueue({
      database,
      loadReportsService: () => ({ _generateRealExport: generateExport })
    });

    await Promise.all([queue.initialize(), queue.initialize()]);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(database.query).toHaveBeenCalledTimes(1);
    expect(generateExport).toHaveBeenCalledWith(
      'report-id',
      'company-id',
      'audit',
      'xlsx'
    );
  });
});
