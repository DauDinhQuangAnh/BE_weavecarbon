const inputFixtures = require('../../../fixtures/carbon/v1/inputs.json');
const { calculateCarbonFootprint } = require('../../../../src/modules/carbon/core');

describe('immutable carbon contribution terms', () => {
  test.each(inputFixtures.cases)('$id preserves reproducible activity x factor terms', (fixture) => {
    const result = calculateCarbonFootprint(fixture.input);

    expect(result.calculationTermsSchemaVersion).toBe('carbon-contribution-terms-v1');
    if (result.perProduct.total > 0) expect(result.calculationTerms.length).toBeGreaterThan(0);
    else expect(result.calculationTerms).toEqual([]);
    result.calculationTerms.forEach((term) => {
      expect(term.activity).toEqual(expect.any(Number));
      expect(term.activityUnit).toMatch(/^(kg|kWh|tonne\.km)$/);
      expect(term.factorId).toBeTruthy();
      expect(term.factorVersionId).toBeTruthy();
      expect(term.factorUnit).toBeTruthy();
      expect(term.source).toBeTruthy();
      expect(term.gwpBasis).toBeTruthy();
      expect(term.kgCo2e).toBeCloseTo(term.activity * term.factorValue, 10);
    });
    const reconstructed = result.calculationTerms.reduce((sum, term) => sum + term.kgCo2e, 0);
    expect(reconstructed).toBeCloseTo(result.perProduct.total, 3);
  });

  test('keeps allocation and transport assumptions with the exact term', () => {
    const result = calculateCarbonFootprint(inputFixtures.cases[0].input);
    const material = result.calculationTerms.find((term) => term.stage === 'materials');
    const transport = result.calculationTerms.find((term) => term.stage === 'logistics_and_storage');

    expect(material.allocation).toEqual(expect.objectContaining({ percentage: expect.any(Number) }));
    expect(transport.allocation).toEqual(expect.objectContaining({
      distanceKm: expect.any(Number),
      shippedMassTonne: expect.any(Number),
      usedDefaultDistance: expect.any(Boolean)
    }));
  });
});
