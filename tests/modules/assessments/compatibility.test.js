jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/domesticCompliance', () => ({
  validateProductsForDomesticPublish: jest.fn(),
  createMissingDocumentsError: jest.fn()
}));
jest.mock('../../../src/modules/shared/security', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));

describe('assessments compatibility entrypoints', () => {
  test('keeps legacy batch service and validators on modular implementations', () => {
    const assessments = require('../../../src/modules/assessments');

    expect(require('../../../src/services/batchesService'))
      .toBe(assessments.batchesService);
    expect(require('../../../src/validators/batchesValidators'))
      .toBe(assessments.batchesValidators);
  });

  test('keeps the public product-batches operation surface unchanged', () => {
    const assessments = require('../../../src/modules/assessments');
    const legacyRouter = require('../../../src/routes/batches');
    const operations = legacyRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`
      ));

    expect(legacyRouter).toBe(assessments.batchesRouter);
    expect(operations).toEqual([
      'GET /',
      'GET /:id',
      'POST /',
      'PATCH /:id',
      'DELETE /:id',
      'POST /:id/items',
      'PATCH /:id/items/:product_id',
      'DELETE /:id/items/:product_id',
      'PATCH /:id/publish'
    ]);
  });
});
