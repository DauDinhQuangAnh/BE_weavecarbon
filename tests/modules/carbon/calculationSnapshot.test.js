const {
  FACTOR_REGISTRY_VERSION,
  buildCalculationMetadata,
  buildFinalizedCalculationSnapshot,
  insertFinalizedProductSnapshot,
  stableCanonicalJson
} = require('../../../src/modules/carbon/calculationSnapshot');

const carbonResult = {
  methodologyVersion: 'methodology-v1',
  methodology: { gwpBasis: 'IPCC_AR5_100y' },
  trace: { ruleEngineVersion: 'engine-v1' },
  factorSourceSummary: [{ factorId: 'factor-1', value: 1.25, unit: 'kgCO2e' }],
  assumptionsUsed: ['Assumption A'],
  perProduct: { total: 1.25 }
};

describe('immutable calculation snapshot builder', () => {
  test('creates a stable input hash independent of object key order', () => {
    const first = buildCalculationMetadata({
      input: { quantity: 2, nested: { z: 1, a: 2 } },
      result: carbonResult,
      calculatedAt: '2026-09-03T00:00:00.000Z'
    });
    const second = buildCalculationMetadata({
      input: { nested: { a: 2, z: 1 }, quantity: 2 },
      result: carbonResult,
      calculatedAt: '2026-09-03T00:00:00.000Z'
    });

    expect(first.canonicalInputHash).toBe(second.canonicalInputHash);
    expect(first.canonicalInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.factorRegistryVersion).toBe(FACTOR_REGISTRY_VERSION);
    expect(FACTOR_REGISTRY_VERSION).toMatch(/^factors-v1:[a-f0-9]{64}$/);
    expect(stableCanonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('freezes exact inputs, factors, assumptions and version metadata in the payload', () => {
    const snapshot = buildFinalizedCalculationSnapshot({
      assessmentPayload: { productName: 'Tee' },
      input: { quantity: 2 },
      result: carbonResult,
      calculatedAt: '2026-09-03T00:00:00.000Z'
    });

    expect(snapshot.payload).toMatchObject({
      productName: 'Tee',
      carbonInput: { quantity: 2 },
      carbonResults: { perProduct: { total: 1.25 } },
      calculationMetadata: {
        schemaVersion: 'carbon-calculation-snapshot-v1',
        engineVersion: 'engine-v1',
        methodologyVersion: 'methodology-v1',
        gwpBasis: 'IPCC_AR5_100y',
        calculatedAt: '2026-09-03T00:00:00.000Z',
        factors: carbonResult.factorSourceSummary,
        assumptions: carbonResult.assumptionsUsed,
        legacy: false
      }
    });
  });

  test('persists recalculation with the next version instead of updating history', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({
        rows: [{ snapshot_id: 'snapshot-2', snapshot_version: 2 }]
      })
    };

    const snapshot = await insertFinalizedProductSnapshot(client, {
      productId: 'product-1',
      assessmentPayload: { productName: 'Tee' },
      input: { quantity: 2 },
      result: carbonResult,
      calculatedAt: '2026-09-03T00:00:00.000Z'
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('COALESCE(MAX(version), 0) + 1');
    expect(sql).not.toContain('UPDATE product_assessment_snapshots');
    expect(JSON.parse(params[1]).calculationMetadata.engineVersion).toBe('engine-v1');
    expect(snapshot.row.snapshot_version).toBe(2);
  });
});
