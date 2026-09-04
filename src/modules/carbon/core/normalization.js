const roundPerProduct = (value) =>
  Math.round((Math.max(0, value) + Number.EPSILON) * 1000) / 1000;

const roundBatch = (value) =>
  Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const sumValues = (values) => values.reduce((sum, value) => sum + value, 0);

const dedupeMessages = (messages) => Array.from(new Set(messages));

const normalizeToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '');

const normalizeCarbonInput = (input) => ({
  ...input,
  unitMassKg: canonicalOrConverted(
    input.unitMassKg,
    input.unitMass,
    input.unitMassUnit,
    'mass'
  ),
  materials: Array.isArray(input.materials) ? input.materials.map((item) => ({ ...item })) : [],
  accessories: Array.isArray(input.accessories) ? input.accessories.map((item) => ({
    ...item,
    weightKg: canonicalOrConverted(item.weightKg, item.weight, item.weightUnit, 'mass')
  })) : [],
  packaging: input.packaging ? {
    ...input.packaging,
    weightKg: canonicalOrConverted(
      input.packaging.weightKg,
      input.packaging.weight,
      input.packaging.weightUnit,
      'mass'
    )
  } : null,
  processFactorIds: Array.isArray(input.processFactorIds) ? [...input.processFactorIds] : [],
  energyMix: Array.isArray(input.energyMix) ? input.energyMix.map((item) => ({ ...item })) : [],
  transport: Array.isArray(input.transport) ? input.transport.map((item) => ({
    ...item,
    distanceKm: canonicalOrConverted(item.distanceKm, item.distance, item.distanceUnit, 'distance')
  })) : []
});

module.exports = {
  clamp,
  dedupeMessages,
  isFiniteNumber,
  normalizeCarbonInput,
  normalizeToken,
  roundBatch,
  roundPerProduct,
  sumValues
};
const { canonicalOrConverted } = require('./units');
