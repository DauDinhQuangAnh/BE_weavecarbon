const ACTOR_ROLES = new Set(['manufacturer', 'brand', 'supplier', 'other']);

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
