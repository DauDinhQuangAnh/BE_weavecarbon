const {
  FACTOR_REGISTRY_VERSION,
  getFactorProvenance,
  getFactorRegistryMetadata,
  listCarbonFactors,
  listFactorProvenance
} = require('../../../../src/modules/carbon/core');

describe('versioned emission factor registry', () => {
  test('derives a stable content-addressed registry identity', () => {
    const first = getFactorRegistryMetadata();
    const second = getFactorRegistryMetadata();

    expect(first).toEqual(second);
    expect(first.version).toBe(FACTOR_REGISTRY_VERSION);
    expect(first.version).toMatch(/^factors-v1:[a-f0-9]{64}$/);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.factorCount).toBe(listCarbonFactors().length);
    expect(Object.isFrozen(first)).toBe(true);
  });

  test('exposes complete queryable provenance without mutating factors', () => {
    const factors = listFactorProvenance();
    const cotton = getFactorProvenance('cotton');

    expect(factors).toHaveLength(getFactorRegistryMetadata().factorCount);
    expect(cotton).toMatchObject({
      registryVersion: FACTOR_REGISTRY_VERSION,
      factorId: 'cat-cotton-100',
      factorVersionId: 'cat-cotton-100:v1',
      unit: 'kgCO2e/kg'
    });
    expect(cotton.source.name).toEqual(expect.any(String));
    expect(cotton.source.url).toEqual(expect.any(String));
    expect(cotton.quality.uncertaintyCv).toEqual(expect.any(Number));
    expect(Object.isFrozen(cotton)).toBe(true);
  });

  test('filters provenance by canonical metadata', () => {
    const energyFactors = listFactorProvenance({ unit: 'kgCO2e/kWh' });
    expect(energyFactors.length).toBeGreaterThan(0);
    expect(energyFactors.every((factor) => factor.unit === 'kgCO2e/kWh')).toBe(true);
  });
});
