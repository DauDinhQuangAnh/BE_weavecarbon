const {
  calculateCarbonFootprint,
  getCarbonFactor,
  resolveCarbonFactorId,
  validateCarbonInput
} = require('../../../../src/modules/carbon/core');
const inputFixtures = require('../../../fixtures/carbon/v1/inputs.json');

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

describe('carbon calculation core purity and validation', () => {
  test('calculation is deterministic and does not mutate a deeply frozen input', () => {
    const input = deepFreeze(structuredClone(inputFixtures.cases[0].input));
    const before = structuredClone(input);

    const first = calculateCarbonFootprint(input);
    const second = calculateCarbonFootprint(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  test('validation rejects incomplete or unsupported input before calculation', () => {
    const validation = validateCarbonInput({
      quantity: '1',
      unitMassKg: 1,
      materials: [],
      accessories: [],
      processFactorIds: [],
      energyMix: [],
      transport: [],
      productCategory: 'food'
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([
      'quantity must be a number',
      'productCategory must be textile when provided'
    ]);
  });

  test('factor aliases resolve without changing the pinned factor records', () => {
    expect(resolveCarbonFactorId('Recycled Polyester')).toBe('cat-polyester-recycled');
    expect(getCarbonFactor('road')).toMatchObject({
      id: 'transport-road-defra-2025',
      factorVersionId: 'transport-road-defra-2025:v1'
    });
  });
});
