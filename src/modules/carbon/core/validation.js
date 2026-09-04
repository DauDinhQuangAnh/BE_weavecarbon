const ACTOR_ROLES = new Set(['manufacturer', 'brand', 'supplier', 'other']);
const { getCarbonFactor } = require('./factorRegistry');

const finiteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validateFactorUnit(errors, factorId, expectedUnit, path) {
  if (!factorId) return;
  const factor = getCarbonFactor(factorId);
  if (factor && factor.unit !== expectedUnit) {
    errors.push(`${path} factor ${factor.id} must use ${expectedUnit}, received ${factor.unit}`);
  }
}

const validateCarbonInput = (input) => {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['input must be an object'] };
  }

  if (typeof input.unitMassKg !== 'number') errors.push('unitMassKg must be a number');
  if (typeof input.quantity !== 'number') errors.push('quantity must be a number');

  for (const field of ['materials', 'accessories', 'processFactorIds', 'energyMix', 'transport']) {
    if (!Array.isArray(input[field])) errors.push(`${field} must be an array`);
  }

  if (input.productCategory !== undefined && input.productCategory !== 'textile') {
    errors.push('productCategory must be textile when provided');
  }
  if (input.reportingActorRole !== undefined && !ACTOR_ROLES.has(input.reportingActorRole)) {
    errors.push('reportingActorRole is invalid');
  }

  const strictPhysicalValidation = input.validationMode === 'strict';
  if (strictPhysicalValidation && !finiteNonNegative(input.unitMassKg)) {
    errors.push('unitMassKg must be a finite non-negative number');
  }
  if (strictPhysicalValidation && (!Number.isInteger(input.quantity) || input.quantity <= 0)) {
    errors.push('quantity must be a positive integer');
  }

  if (strictPhysicalValidation && Array.isArray(input.materials)) {
    let coverage = 0;
    input.materials.forEach((material, index) => {
      if (!finiteNonNegative(material.percentage) || material.percentage > 100) {
        errors.push(`materials[${index}].percentage must be between 0 and 100`);
      } else {
        coverage += material.percentage;
      }
      if (material.yieldToProduct !== undefined && (
        !finiteNonNegative(material.yieldToProduct) || material.yieldToProduct <= 0 || material.yieldToProduct > 1
      )) {
        errors.push(`materials[${index}].yieldToProduct must be greater than 0 and at most 1`);
      }
      validateFactorUnit(errors, material.factorId, 'kgCO2e/kg', `materials[${index}]`);
    });
    if (coverage > 105) errors.push('material BOM coverage cannot exceed 105%');
    if (input.materials.length > 0 && coverage <= 0) {
      errors.push('material BOM coverage must be greater than 0% when materials are provided');
    }
  }

  if (strictPhysicalValidation && Array.isArray(input.accessories)) {
    input.accessories.forEach((accessory, index) => {
      if (accessory.weightKg !== undefined && !finiteNonNegative(accessory.weightKg)) {
        errors.push(`accessories[${index}].weightKg must be a finite non-negative number`);
      }
      validateFactorUnit(errors, accessory.factorId, 'kgCO2e/kg', `accessories[${index}]`);
    });
  }

  if (strictPhysicalValidation && input.packaging) {
    if (input.packaging.weightKg !== undefined && !finiteNonNegative(input.packaging.weightKg)) {
      errors.push('packaging.weightKg must be a finite non-negative number');
    }
    validateFactorUnit(errors, input.packaging.factorId, 'kgCO2e/kg', 'packaging');
  }

  if (strictPhysicalValidation && Array.isArray(input.processFactorIds)) {
    input.processFactorIds.forEach((factorId, index) => {
      validateFactorUnit(errors, factorId, 'kWh/kg', `processFactorIds[${index}]`);
    });
  }

  if (strictPhysicalValidation && Array.isArray(input.energyMix)) {
    let coverage = 0;
    input.energyMix.forEach((entry, index) => {
      if (!finiteNonNegative(entry.percentage) || entry.percentage > 100) {
        errors.push(`energyMix[${index}].percentage must be between 0 and 100`);
      } else {
        coverage += entry.percentage;
      }
      validateFactorUnit(errors, entry.factorId, 'kgCO2e/kWh', `energyMix[${index}]`);
    });
    if (coverage > 105) errors.push('energy mix coverage cannot exceed 105%');
    if (input.energyMix.length > 0 && coverage <= 0) {
      errors.push('energy mix coverage must be greater than 0% when entries are provided');
    }
  }

  if (strictPhysicalValidation && Array.isArray(input.transport)) {
    input.transport.forEach((leg, index) => {
      if (leg.distanceKm !== undefined && (!finiteNonNegative(leg.distanceKm) || leg.distanceKm <= 0)) {
        errors.push(`transport[${index}].distanceKm must be a positive finite number when provided`);
      }
      validateFactorUnit(errors, leg.factorId, 'kgCO2e/tonne.km', `transport[${index}]`);
    });
  }

  return { valid: errors.length === 0, errors };
};

const assertValidCarbonInput = (input) => {
  const result = validateCarbonInput(input);
  if (!result.valid) {
    throw new TypeError(`Invalid carbon input: ${result.errors.join('; ')}`);
  }
  return input;
};

module.exports = { assertValidCarbonInput, validateCarbonInput };
