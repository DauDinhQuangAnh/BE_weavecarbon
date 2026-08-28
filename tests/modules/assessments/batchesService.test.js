jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));
jest.mock('../../../src/modules/shared/domesticCompliance', () => ({
  validateProductsForDomesticPublish: jest.fn(),
  createMissingDocumentsError: jest.fn()
}));

const { createBatchesService } = require('../../../src/modules/assessments');

function createDependencies() {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };
  const database = {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(client)
  };
  const complianceService = {
    validateProductsForDomesticPublish: jest.fn(),
    createMissingDocumentsError: jest.fn()
  };

  return { client, database, complianceService };
}

describe('BatchesService', () => {
  test('returns null when a batch does not belong to the company', async () => {
    const dependencies = createDependencies();
    dependencies.database.query.mockResolvedValue({ rows: [] });
    const service = createBatchesService(dependencies);

    await expect(service.getBatchById('batch-1', 'company-1')).resolves.toBeNull();
    expect(dependencies.database.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE pb.id = $1 AND pb.company_id = $2'),
      ['batch-1', 'company-1']
    );
  });

  test('maps list filters, totals and pagination without changing the public shape', async () => {
    const dependencies = createDependencies();
    dependencies.database.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'batch-1',
          name: 'Export lot',
          description: null,
          status: 'draft',
          origin_address: { country: 'Vietnam' },
          destination_address: { country: 'France' },
          destination_market: 'EU',
          transport_modes: ['sea'],
          shipment_id: null,
          total_products: 2,
          total_quantity: '10.5',
          total_weight_kg: '25.25',
          total_co2e: '4.75',
          published_at: null,
          created_at: 'created',
          updated_at: 'updated'
        }]
      });
    const service = createBatchesService(dependencies);

    const result = await service.listBatches('company-1', {
      search: 'Export',
      status: 'draft',
      page: 2,
      page_size: 5
    });

    expect(result).toEqual({
      items: [expect.objectContaining({
        id: 'batch-1',
        name: 'Export lot',
        totalQuantity: 10.5,
        totalWeight: 25.25,
        totalCO2: 4.75
      })],
      pagination: { page: 2, page_size: 5, total: 1, total_pages: 1 }
    });
    expect(dependencies.database.query.mock.calls[1][0]).toContain('LIMIT $4 OFFSET $5');
    expect(dependencies.database.query.mock.calls[1][1]).toEqual([
      'company-1',
      'draft',
      '%Export%',
      5,
      5
    ]);
  });

  test('rolls back and releases the transaction when adding to a missing batch', async () => {
    const dependencies = createDependencies();
    dependencies.client.query.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT id, status FROM product_batches')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const service = createBatchesService(dependencies);

    await expect(service.addBatchItem('batch-1', 'company-1', {
      product_id: 'product-1',
      quantity: 1
    })).rejects.toThrow('BATCH_NOT_FOUND');

    expect(dependencies.client.query).toHaveBeenCalledWith('BEGIN');
    expect(dependencies.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(dependencies.client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(dependencies.client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back publish when domestic compliance rejects a product', async () => {
    const dependencies = createDependencies();
    const complianceError = Object.assign(new Error('Missing documents'), {
      code: 'MISSING_DOMESTIC_DOCUMENTS'
    });
    dependencies.complianceService.validateProductsForDomesticPublish
      .mockResolvedValue({ success: false, requiredDocuments: ['invoice'] });
    dependencies.complianceService.createMissingDocumentsError
      .mockReturnValue(complianceError);
    dependencies.client.query.mockImplementation(async (sql) => {
      const query = String(sql);
      if (query.includes('FROM product_batches pb')) {
        return {
          rows: [{
            id: 'batch-1',
            status: 'draft',
            total_products: 1,
            total_weight_kg: '10',
            total_co2e: '2',
            origin_address: null,
            destination_address: null,
            transport_modes: ['road']
          }]
        };
      }
      if (query.includes('SELECT product_id')) {
        return { rows: [{ product_id: 'product-1' }] };
      }
      return { rows: [] };
    });
    const service = createBatchesService(dependencies);

    await expect(service.publishBatch('batch-1', 'company-1', 'user-1'))
      .rejects.toBe(complianceError);
    expect(dependencies.complianceService.validateProductsForDomesticPublish)
      .toHaveBeenCalledWith(dependencies.client, 'company-1', ['product-1']);
    expect(dependencies.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(dependencies.client.release).toHaveBeenCalledTimes(1);
  });

  test('builds a deterministic single-mode shipment leg', () => {
    const service = createBatchesService(createDependencies());

    const result = service._buildBatchShipmentLegs(
      { transport_modes: ['truck'] },
      { city: 'Hanoi', country: 'Vietnam', lat: 21.0285, lng: 105.8542 },
      { city: 'Hai Phong', country: 'Vietnam', lat: 20.8449, lng: 106.6881 },
      1000
    );

    expect(result.skipReason).toBeNull();
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toEqual(expect.objectContaining({
      transport_mode: 'road',
      origin_location: 'Hanoi',
      destination_location: 'Hai Phong',
      emission_factor_used: 0.12226
    }));
    expect(result.legs[0].distance_km).toBeGreaterThan(80);
    expect(result.legs[0].co2e).toBeGreaterThan(0);
  });

  test('skips shipment creation when a batch has multiple modes without leg distances', () => {
    const service = createBatchesService(createDependencies());

    expect(service._buildBatchShipmentLegs(
      { transport_modes: ['road', 'sea'] },
      { country: 'Vietnam', lat: 10, lng: 106 },
      { country: 'France', lat: 48, lng: 2 },
      1000
    )).toEqual({ legs: [], skipReason: 'MISSING_MULTIMODAL_LEG_DISTANCES' });
  });
});
