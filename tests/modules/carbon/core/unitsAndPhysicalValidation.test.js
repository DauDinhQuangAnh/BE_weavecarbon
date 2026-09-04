const {
  CANONICAL_UNITS,
  calculateCarbonFootprint,
  convertToCanonical,
  normalizeCarbonInput,
  validateCarbonInput
} = require('../../../../src/modules/carbon/core');

const baseInput = (overrides = {}) => ({
  validationMode: 'strict',
  productCategory: 'textile',
  reportingActorRole: 'manufacturer',
  unitMassKg: 1,
  quantity: 1,
  materials: [],
  accessories: [],
  processFactorIds: [],
  energyMix: [],
  transport: [],
  ...overrides
});

describe('canonical units and physical input validation', () => {
  test.each([
    [1000, 'g', 'mass', 1],
    [1.5, 'tonne', 'mass', 1500],
    [2, 'MWh', 'energy', 2000],
    [1, 'mi', 'distance', 1.609344]
  ])('converts %p %s %s to canonical units', (value, unit, type, expected) => {
    expect(convertToCanonical(value, unit, type)).toBeCloseTo(expected, 9);
  });

  test('normalizes equivalent units before calculation without numerical drift', () => {
    const kilograms = calculateCarbonFootprint(baseInput({ unitMassKg: 1 }));
    const grams = calculateCarbonFootprint(baseInput({
      unitMassKg: undefined,
      unitMass: 1000,
      unitMassUnit: 'g'
    }));

    expect(grams.perProduct).toEqual(kilograms.perProduct);
    expect(grams.totalBatch).toEqual(kilograms.totalBatch);
    expect(grams.units).toBe(CANONICAL_UNITS);
  });

  test('rejects negative, unsupported and physically invalid strict inputs', () => {
    expect(() => convertToCanonical(-1, 'kg', 'mass')).toThrow('cannot be negative');
    expect(() => convertToCanonical(1, 'lb', 'mass')).toThrow('Unsupported mass unit');

    const normalized = normalizeCarbonInput(baseInput({
      quantity: 0,
      materials: [{ percentage: 110, factorId: 'cat-cotton-100' }],
      transport: [{ distanceKm: -1, factorId: 'transport-road-defra-2025' }]
    }));
    const validation = validateCarbonInput(normalized);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      'quantity must be a positive integer',
      'materials[0].percentage must be between 0 and 100',
      'transport[0].distanceKm must be a positive finite number when provided'
    ]));
  });

  test('rejects factors whose dimensional unit does not match the stage', () => {
    const validation = validateCarbonInput(baseInput({
      materials: [{ percentage: 100, factorId: 'energy-grid-generic' }]
    }));
    expect(validation.errors.join(' ')).toContain('must use kgCO2e/kg');
  });
});
