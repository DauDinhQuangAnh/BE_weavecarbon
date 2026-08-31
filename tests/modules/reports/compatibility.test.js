jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/security', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));
jest.mock('../../../src/modules/shared/auditing', () => ({
  logAuditTrail: jest.fn()
}));
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

describe('reports compatibility entrypoints', () => {
  test('keeps legacy imports on the modular implementations', () => {
    const reports = require('../../../src/modules/reports');

    expect(require('../../../src/routes/reports')).toBe(reports.reportsRouter);
    expect(require('../../../src/services/reportsService')).toBe(reports.reportsService);
    expect(require('../../../src/services/reportsService/helpers')).toBe(reports.helpers);
    expect(require('../../../src/services/pdfReportService')).toBe(reports.pdfReportService);
    expect(require('../../../src/services/reportJobQueue')).toBe(reports.reportJobQueue);
    expect(require('../../../src/validators/reportsValidators')).toBe(reports.validators);
  });

  test('keeps the complete Reports operation surface and route order unchanged', () => {
    const router = require('../../../src/modules/reports').reportsRouter;
    const operations = router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`
      ));

    expect(operations).toEqual([
      'GET /',
      'POST /exports',
      'POST /export-jobs',
      'GET /export-sources',
      'GET /export-sources/:type',
      'GET /export-data/:type',
      'GET /v2/template',
      'POST /v2/snapshots',
      'GET /:id',
      'GET /:id/status',
      'GET /:id/download',
      'POST /',
      'DELETE /:id',
      'PATCH /:id/status'
    ]);
  });
});
