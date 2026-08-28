describe('products compatibility entrypoints', () => {
  test('keeps legacy service, validator and helper imports on modular implementations', () => {
    const products = require('../../../src/modules/products');

    expect(require('../../../src/services/productsService'))
      .toBe(products.productsService);
    expect(require('../../../src/validators/productsValidators'))
      .toBe(products.productsValidators);

    for (const helperName of Object.keys(products.services)) {
      expect(require(`../../../src/services/productsService/${helperName}`))
        .toBe(products.services[helperName]);
    }
  });

  test('keeps the public products route operation surface unchanged', () => {
    const products = require('../../../src/modules/products');
    const legacyRouter = require('../../../src/routes/products');
    const operations = legacyRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`
      ));

    expect(legacyRouter).toBe(products.productsRouter);
    expect(operations).toEqual([
      'GET /',
      'GET /bulk-template',
      'GET /bulk-template.xlsx',
      'POST /bulk-import/validate',
      'POST /bulk-import/file',
      'GET /:id',
      'POST /',
      'PUT /:id',
      'PATCH /:id/status',
      'DELETE /:id',
      'POST /bulk-import'
    ]);
  });
});
