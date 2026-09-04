const CANONICAL_UNITS = Object.freeze({
  mass: 'kg',
  energy: 'kWh',
  fuelVolume: 'L',
  distance: 'km',
  freightActivity: 'tonne.km',
  emissions: 'kgCO2e',
  materialFactor: 'kgCO2e/kg',
  energyFactor: 'kgCO2e/kWh',
  processIntensity: 'kWh/kg',
  transportFactor: 'kgCO2e/tonne.km'
});

const UNIT_CONVERSIONS = Object.freeze({
  mass: Object.freeze({ kg: 1, g: 0.001, tonne: 1000, t: 1000 }),
  energy: Object.freeze({ kWh: 1, Wh: 0.001, MWh: 1000 }),
  fuelVolume: Object.freeze({ L: 1, l: 1, mL: 0.001 }),
  distance: Object.freeze({ km: 1, m: 0.001, mi: 1.609344 }),
  freightActivity: Object.freeze({ 'tonne.km': 1, tkm: 1 })
});

const ROUNDING_POLICY = Object.freeze({
  calculation: 'Use full JavaScript Number precision for intermediate calculations.',
  perProduct: 'Round once at the result boundary to 3 decimal places (kgCO2e).',
  totalBatch: 'Round once at the result boundary to 2 decimal places (kgCO2e).',
  persistedFactors: 'Persist the exact registry value and unit used; never infer a unit later.'
});

function convertToCanonical(value, unit, quantityType) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${quantityType} value must be a finite number`);
  }
  if (value < 0) {
    throw new TypeError(`${quantityType} value cannot be negative`);
  }
  if (!unit) {
    throw new TypeError(`${quantityType} unit is required`);
  }
  const conversion = UNIT_CONVERSIONS[quantityType]?.[unit];
  if (!conversion) {
    throw new TypeError(`Unsupported ${quantityType} unit: ${unit}`);
  }
  return value * conversion;
}

function canonicalOrConverted(canonicalValue, value, unit, quantityType) {
  if (canonicalValue !== undefined) return canonicalValue;
  if (value === undefined) return canonicalValue;
  return convertToCanonical(value, unit, quantityType);
}

module.exports = {
  CANONICAL_UNITS,
  ROUNDING_POLICY,
  UNIT_CONVERSIONS,
  canonicalOrConverted,
  convertToCanonical
};
