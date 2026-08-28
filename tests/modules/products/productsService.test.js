const { createProductsService } = require('../../../src/modules/products');

function createDependencies() {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };
  const database = {
    connect: jest.fn().mockResolvedValue(client)
  };
  const complianceService = {
    validateProductsForDomesticPublish: jest.fn()
  };
  const ensureSimulationSchema = jest.fn().mockResolvedValue(undefined);
  const bulkImportProducts = jest.fn();

  return {
    client,
    database,
    complianceService,
    ensureSimulationSchema,
    bulkImportProducts
  };
}

describe('ProductsService', () => {
  test('returns null and releases the connection when a product is not found', async () => {
    const dependencies = createDependencies();
    dependencies.client.query.mockResolvedValueOnce({ rows: [] });
    const service = createProductsService(dependencies);

    await expect(service.getProductById('product-1', 'company-1')).resolves.toBeNull();

    expect(dependencies.database.connect).toHaveBeenCalledTimes(1);
    expect(dependencies.client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE p.id = $1 AND p.company_id = $2'),
      ['product-1', 'company-1']
    );
    expect(dependencies.client.release).toHaveBeenCalledTimes(1);
  });

  test('releases the connection when listing products fails', async () => {
    const dependencies = createDependencies();
    dependencies.client.query.mockRejectedValueOnce(new Error('database unavailable'));
    const service = createProductsService(dependencies);

    await expect(service.listProducts('company-1')).rejects.toThrow('database unavailable');
    expect(dependencies.client.release).toHaveBeenCalledTimes(1);
  });

  test('delegates bulk import without changing arguments or results', async () => {
    const dependencies = createDependencies();
    const expected = { imported: 2, failed: 0 };
    dependencies.bulkImportProducts.mockResolvedValue(expected);
    const service = createProductsService(dependencies);
    const rows = [{ sku: 'SKU-1' }, { sku: 'SKU-2' }];

    await expect(
      service.bulkImport('company-1', 'user-1', rows, 'publish')
    ).resolves.toBe(expected);
    expect(dependencies.bulkImportProducts).toHaveBeenCalledWith(
      'company-1',
      'user-1',
      rows,
      'publish'
    );
  });
});
