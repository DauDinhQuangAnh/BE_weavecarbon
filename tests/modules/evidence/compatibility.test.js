jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/security', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));
jest.mock('../../../src/modules/shared/rag', () => ({
  callGlobalRagEndpoint: jest.fn()
}));
jest.mock('../../../src/modules/shared/auditing', () => ({
  logAuditTrail: jest.fn()
}));
jest.mock('../../../src/modules/shared/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

describe('evidence compatibility entrypoints', () => {
  test('keeps legacy route, service and storage imports on module implementations', () => {
    const evidence = require('../../../src/modules/evidence');

    expect(require('../../../src/routes/evidence')).toBe(evidence.evidenceRouter);
    expect(require('../../../src/services/evidenceService')).toBe(evidence.evidenceService);
    expect(require('../../../src/services/evidenceFileStorage')).toBe(evidence.fileStorage);
  });

  test('keeps the complete Evidence operation surface unchanged', () => {
    const router = require('../../../src/modules/evidence').evidenceRouter;
    const operations = router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`
      ));

    expect(operations).toEqual([
      'POST /:id/verify',
      'POST /upload',
      'POST /:id/rag-ingest',
      'GET /',
      'POST /',
      'POST /:id/lock',
      'GET /:id/status',
      'GET /:id/fields',
      'POST /:id/confirm',
      'GET /product/:product_id',
      'DELETE /:id'
    ]);
  });
});
