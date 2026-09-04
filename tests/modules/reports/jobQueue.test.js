jest.mock('../../../src/modules/shared/logger', () => ({
  error: jest.fn(), info: jest.fn(), warn: jest.fn()
}));

const { createReportJobQueue } = require('../../../src/modules/reports');

function repositoryStub(overrides = {}) {
  return {
    enqueue: jest.fn().mockResolvedValue({ accepted: true, id: 'job-id', status: 'pending' }),
    recoverStale: jest.fn().mockResolvedValue(0),
    backfillReports: jest.fn().mockResolvedValue(0),
    backfillEvidence: jest.fn().mockResolvedValue(0),
    claimNext: jest.fn().mockResolvedValue(null),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue('retry'),
    counts: jest.fn().mockResolvedValue({}),
    ...overrides
  };
}

describe('durable operational queue', () => {
  test('maps persisted report rows to compatible worker task types', () => {
    const queue = createReportJobQueue({ repository: repositoryStub() });

    expect(queue._rowToTask({
      id: 'dataset-id', company_id: 'company-id', report_type: 'dataset_export',
      dataset_type: 'product', file_format: 'csv'
    })).toEqual({
      type: 'dataset_export', reportId: 'dataset-id', companyId: 'company-id',
      datasetType: 'product', fileFormat: 'csv'
    });
    expect(queue._rowToTask({
      id: 'pdf-id', company_id: 'company-id', report_type: 'compliance', file_format: 'pdf'
    })).toEqual({ type: 'manual_report', reportId: 'pdf-id', companyId: 'company-id' });
  });

  test('uses a stable idempotency key for duplicate enqueue requests', async () => {
    const repository = repositoryStub();
    repository.enqueue
      .mockResolvedValueOnce({ accepted: true, id: 'job-id', status: 'pending' })
      .mockResolvedValueOnce({ accepted: false, id: 'job-id', status: 'pending' });
    const queue = createReportJobQueue({ repository });
    const task = { type: 'manual_report', reportId: 'report-id', companyId: 'company-id' };

    await expect(queue.enqueue(task)).resolves.toBe(true);
    await expect(queue.enqueue(task)).resolves.toBe(false);
    expect(repository.enqueue.mock.calls[0][0].idempotencyKey).toBe('report:report-id');
    expect(repository.enqueue.mock.calls[1][0].idempotencyKey).toBe('report:report-id');
  });

  test('recovers interrupted work and backfills durable sources on restart', async () => {
    const repository = repositoryStub({
      recoverStale: jest.fn().mockResolvedValue(2),
      backfillReports: jest.fn().mockResolvedValue(1),
      backfillEvidence: jest.fn().mockResolvedValue(1)
    });
    const queue = createReportJobQueue({ repository, pollIntervalMs: 60000 });

    await queue.initialize();
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.recoverStale).toHaveBeenCalledTimes(1);
    expect(repository.backfillReports).toHaveBeenCalledTimes(1);
    expect(repository.backfillEvidence).toHaveBeenCalledTimes(1);
    expect(queue.isReady()).toBe(true);
    await queue.stop();
  });

  test('records retry and dead-job outcomes without dropping failures', async () => {
    const repository = repositoryStub();
    const failure = new Error('renderer unavailable');
    const queue = createReportJobQueue({
      repository,
      retryBaseMs: 10,
      loadReportsService: () => ({ _generateRealReport: jest.fn().mockRejectedValue(failure) })
    });

    await queue._execute({
      id: 'job-1', kind: 'manual_report', attempts: 1, max_attempts: 3,
      payload: { type: 'manual_report', reportId: 'report-1', companyId: 'company-1' }
    });
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }),
      'renderer unavailable', 10);

    repository.fail.mockResolvedValueOnce('dead');
    await queue._execute({
      id: 'job-2', kind: 'manual_report', attempts: 3, max_attempts: 3,
      payload: { type: 'manual_report', reportId: 'report-2', companyId: 'company-1' }
    });
    expect(repository.fail).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'job-2' }),
      'renderer unavailable', 40);
  });

  test('dispatches and completes a claimed job', async () => {
    const generate = jest.fn().mockResolvedValue(undefined);
    const repository = repositoryStub({
      claimNext: jest.fn()
        .mockResolvedValueOnce({
          id: 'job-1', kind: 'manual_report', attempts: 1, max_attempts: 3,
          payload: { type: 'manual_report', reportId: 'report-1', companyId: 'company-1' }
        })
        .mockResolvedValue(null)
    });
    const queue = createReportJobQueue({
      repository, pollIntervalMs: 60000,
      loadReportsService: () => ({ _generateRealReport: generate })
    });

    await queue.initialize();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(generate).toHaveBeenCalledWith('report-1', 'company-1');
    expect(repository.complete).toHaveBeenCalledWith('job-1', undefined);
    await queue.stop();
  });
});
