const { createProductsService } = require('../../../src/modules/products');

const authoritativeResult = {
  perProduct: {
    materials: 2.864,
    production: 1.591,
    energy: 0,
    transport: 0.106,
    packaging: 0.017,
    total: 4.577
  },
  confidenceScore: 77,
  confidenceLevel: 'medium',
  trace: {
    calculationGraphVersion: 'textile-pcf-2.1.0',
    ruleEngineVersion: 'scope-quality-rss-1.0.0'
  }
};

const snapshotRow = (version) => ({
  snapshot_id: `snapshot-${version}`,
  snapshot_version: version,
  snapshot_calculated_at: '2026-09-03T00:00:00.000Z',
  snapshot_engine_version: 'scope-quality-rss-1.0.0',
  snapshot_methodology_version: 'textile-pcf-2.1.0',
  snapshot_factor_registry_version: 'factors-v1:test',
  snapshot_gwp_basis: 'IPCC_AR5_100y',
  snapshot_canonical_input_hash: 'a'.repeat(64),
  snapshot_is_legacy: false
});

describe('product assessment authoritative carbon persistence', () => {
  test('create persists and returns the server result instead of client totals', async () => {
    const client = {
      query: jest.fn((sql) => {
        const text = String(sql);
        if (text.includes('SELECT is_demo_user')) {
          return Promise.resolve({ rows: [{ is_demo_user: false }] });
        }
        if (text.includes('SELECT id FROM products')) return Promise.resolve({ rows: [] });
        if (text.includes('INSERT INTO products')) {
          return Promise.resolve({
            rows: [{ id: 'product-1', status: 'draft', created_at: 'created' }]
          });
        }
        if (text.includes('INSERT INTO product_assessment_snapshots')) {
          return Promise.resolve({ rows: [snapshotRow(1)] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn()
    };
    const service = createProductsService({
      database: { connect: jest.fn().mockResolvedValue(client) },
      ensureSimulationSchema: jest.fn().mockResolvedValue(undefined)
    });
    const payload = {
      productCode: 'SKU-1',
      productName: 'Tee',
      productType: 'tshirt',
      weightPerUnit: 200,
      quantity: 10,
      carbonResults: { perProduct: { total: 999999, materials: 999999 } },
      carbon_results: { per_product: { total: 888888 } },
      total_co2e: 777777,
      scope3: 666666,
      materials: [],
      accessories: [],
      productionProcesses: [],
      energySources: [],
      transportLegs: []
    };

    const response = await service.createProduct('company-1', 'user-1', payload);

    const productInsert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO products')
    );
    expect(productInsert[1].slice(6, 12)).toEqual([
      0.21,
      0,
      0.21,
      0,
      0,
      15
    ]);

    const snapshotInsert = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO product_assessment_snapshots')
    );
    const snapshot = JSON.parse(snapshotInsert[1][1]);
    expect(snapshot.carbonResults).toMatchObject({
      perProduct: { total: 0.21 },
      confidenceScore: 15,
      trace: {
        calculationGraphVersion: 'textile-pcf-2.1.0',
        ruleEngineVersion: 'scope-quality-rss-1.0.0'
      }
    });
    expect(snapshot.carbonInput).toMatchObject({ unitMassKg: 0.2, quantity: 10 });
    expect(snapshot).not.toHaveProperty('carbon_results');
    expect(snapshot).not.toHaveProperty('total_co2e');
    expect(snapshot).not.toHaveProperty('scope3');
    expect(response.carbonResults.perProduct.total).toBe(0.21);
    expect(response.carbonAuthority).toMatchObject({
      calculationId: 'snapshot-1',
      calculationVersion: 1,
      engineVersion: 'scope-quality-rss-1.0.0',
      legacy: false
    });
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('publishing recomputes an existing draft before finalization', async () => {
    const snapshotPayload = {
      quantity: 10,
      materials: [],
      accessories: [],
      productionProcesses: [],
      energySources: [],
      transportLegs: [],
      carbonResults: { perProduct: { total: 999999 } }
    };
    const client = {
      query: jest.fn((sql) => {
        const text = String(sql);
        if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [] });
        if (text.includes('SELECT p.id, p.status')) {
          return Promise.resolve({
            rows: [{
              id: 'product-1',
              status: 'draft',
              weight_kg: '0.2',
              total_co2e: '999999',
              transport_co2e: '999999',
              payload: snapshotPayload
            }]
          });
        }
        if (text.includes('SET status = $1')) {
          return Promise.resolve({ rows: [{ status: 'active', updated_at: 'updated' }] });
        }
        if (text.includes('INSERT INTO product_assessment_snapshots')) {
          return Promise.resolve({ rows: [snapshotRow(2)] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn()
    };
    const calculateProductCarbon = jest.fn().mockReturnValue({
      input: { unitMassKg: 0.2, quantity: 10 },
      result: authoritativeResult
    });
    const service = createProductsService({
      database: { connect: jest.fn().mockResolvedValue(client) },
      ensureSimulationSchema: jest.fn().mockResolvedValue(undefined),
      complianceService: {
        validateProductsForDomesticPublish: jest.fn().mockResolvedValue({ success: true })
      },
      calculateProductCarbon
    });

    const response = await service.updateProductStatus(
      'product-1',
      'company-1',
      'user-1',
      'published'
    );

    expect(calculateProductCarbon).toHaveBeenCalledWith(expect.objectContaining({
      weightPerUnit: 200,
      carbonResults: { perProduct: { total: 999999 } }
    }));
    const carbonUpdate = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET total_co2e = $1')
    );
    expect(carbonUpdate[1].slice(0, 6)).toEqual([4.577, 2.864, 1.591, 0.106, 0.017, 77]);
    expect(response.data.carbonResults).toEqual(authoritativeResult);
    expect(response.data.shipmentCreationSkipped).toBe(true);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('update replaces tampered totals in both product columns and snapshot', async () => {
    const client = {
      query: jest.fn((sql) => {
        const text = String(sql);
        if (text.includes('SELECT is_demo_user')) return Promise.resolve({ rows: [] });
        if (text.includes('SELECT id, status FROM products')) {
          return Promise.resolve({ rows: [{ id: 'product-1', status: 'draft' }] });
        }
        if (text.includes('UPDATE products') && text.includes('sku = $1')) {
          return Promise.resolve({ rows: [{ status: 'draft', updated_at: 'updated' }] });
        }
        if (text.includes('INSERT INTO product_assessment_snapshots')) {
          return Promise.resolve({ rows: [snapshotRow(2)] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn()
    };
    const calculateProductCarbon = jest.fn().mockReturnValue({
      input: { unitMassKg: 0.2, quantity: 10 },
      result: authoritativeResult
    });
    const service = createProductsService({
      database: { connect: jest.fn().mockResolvedValue(client) },
      ensureSimulationSchema: jest.fn().mockResolvedValue(undefined),
      calculateProductCarbon
    });

    const response = await service.updateProduct(
      'product-1',
      'company-1',
      'user-1',
      {
        productCode: 'SKU-1',
        productName: 'Updated Tee',
        productType: 'tshirt',
        weightPerUnit: 200,
        quantity: 10,
        carbonResults: { perProduct: { total: 999999 } },
        total_co2e: 999999,
        materials: [],
        accessories: [],
        productionProcesses: [],
        energySources: [],
        transportLegs: []
      }
    );

    const productUpdate = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE products') && String(sql).includes('sku = $1')
    );
    expect(productUpdate[1].slice(4, 10)).toEqual([4.577, 2.864, 1.591, 0.106, 0.017, 77]);
    const snapshotUpdate = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO product_assessment_snapshots')
    );
    const snapshot = JSON.parse(snapshotUpdate[1][1]);
    expect(snapshot.carbonResults).toEqual(authoritativeResult);
    expect(snapshot).not.toHaveProperty('total_co2e');
    expect(response.data.carbonResults).toEqual(authoritativeResult);
    expect(response.data.version).toBe(2);
  });
});
