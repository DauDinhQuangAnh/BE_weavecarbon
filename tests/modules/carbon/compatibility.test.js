jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/security', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));

function operations(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map(
      (method) => `${method.toUpperCase()} ${layer.route.path}`
    ));
}

describe('carbon compatibility entrypoints', () => {
  test('keeps all legacy routers on the public Carbon module surface', () => {
    const carbon = require('../../../src/modules/carbon');

    expect(require('../../../src/routes/carbonCalculations'))
      .toBe(carbon.carbonCalculationsRouter);
    expect(require('../../../src/routes/electricityInvoices'))
      .toBe(carbon.electricityInvoicesRouter);
    expect(require('../../../src/routes/fuelInvoices'))
      .toBe(carbon.fuelInvoicesRouter);
  });

  test('keeps the complete runtime operation surface unchanged', () => {
    const carbon = require('../../../src/modules/carbon');

    expect(operations(carbon.carbonCalculationsRouter)).toEqual([
      'GET /',
      'POST /'
    ]);
    expect(operations(carbon.electricityInvoicesRouter)).toEqual([
      'GET /',
      'POST /',
      'PUT /:id',
      'DELETE /:id'
    ]);
    expect(operations(carbon.fuelInvoicesRouter)).toEqual([
      'GET /',
      'POST /',
      'PUT /:id',
      'DELETE /:id'
    ]);
  });
});
