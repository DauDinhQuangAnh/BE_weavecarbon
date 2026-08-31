const {
  calculateAuthoritativeProductCarbon,
  stripClientCarbonOutputs
} = require('../../../src/modules/carbon');

describe('authoritative product carbon adapter', () => {
  test('normalizes assessment activity data and calculates on the backend', () => {
    const { input, result } = calculateAuthoritativeProductCarbon({
      weightPerUnit: 200,
      quantity: 10,
      productCategory: 'textile',
      materials: [{
        id: 'material-1',
        materialType: 'cotton',
        percentage: 100,
        source: 'domestic'
      }],
      accessories: [],
      productionProcesses: ['cutting_sewing'],
      energySources: [{ source: 'grid', percentage: 100 }],
      manufacturingLocation: 'Vietnam',
      originAddress: { country: 'Vietnam' },
      destinationMarket: 'eu',
      transportLegs: [{ mode: 'sea', estimatedDistance: 10000 }]
    });

    expect(input).toMatchObject({
      unitMassKg: 0.2,
      quantity: 10,
      processFactorIds: ['process-cutting-sewing'],
      energyMix: [{ factorId: 'energy-grid-vn-2023', percentage: 100 }],
      transport: [{ factorId: 'transport-sea-defra-2025', distanceKm: 10000 }]
    });
    expect(result.perProduct.total).toBeGreaterThan(0);
    expect(result.trace).toEqual(expect.objectContaining({
      calculationGraphVersion: 'textile-pcf-2.1.0',
      ruleEngineVersion: 'scope-quality-rss-1.0.0'
    }));
  });

  test('removes every client-computed carbon output before snapshot persistence', () => {
    expect(stripClientCarbonOutputs({
      productName: 'Tee',
      carbonResults: { perProduct: { total: 999999 } },
      carbon_results: { per_product: { total: 999999 } },
      total_co2e: 999999,
      reportedTotalKgCO2e: 999999,
      trace: { ruleEngineVersion: 'client-controlled' },
      confidenceScore: 100,
      scope3: 999999
    })).toEqual({ productName: 'Tee' });
  });
});
