const factors = require('./factors.v1.json');
const { normalizeToken } = require('./normalization');

const FACTOR_ID_ALIASES = {
  cotton: 'cat-cotton-100',
  organiccotton: 'cat-cotton-organic',
  recycledcotton: 'cat-cotton-recycled',
  polyester: 'cat-polyester-100',
  recycledpolyester: 'cat-polyester-recycled',
  wool: 'cat-wool-100',
  silk: 'cat-silk-100',
  linen: 'cat-linen-100',
  nylon: 'cat-nylon-100',
  bamboo: 'cat-bamboo',
  hemp: 'cat-hemp',
  tencel: 'cat-tencel',
  viscose: 'cat-viscose',
  acrylic: 'cat-acrylic',
  leather: 'cat-leather-genuine',
  fauxleather: 'cat-leather-faux',
  blend: 'cat-blend-cotton-poly',
  mixed: 'cat-blend-cotton-poly',
  zipper: 'cat-zipper-plastic',
  button: 'cat-button-plastic',
  thread: 'cat-thread-polyester',
  label: 'cat-label-woven',
  elastic: 'cat-elastic-band',
  lining: 'cat-lining-polyester',
  padding: 'cat-padding-polyester',
  packagingplastic: 'cat-packaging-plastic-bag',
  packagingpaper: 'cat-packaging-paper-box',
  plastic: 'cat-packaging-plastic-bag',
  paper: 'cat-packaging-paper-box',
  biodegradable: 'packaging-biodegradable-proxy',
  recycled: 'packaging-recycled-proxy',
  minimal: 'packaging-minimal-proxy',
  other: 'cat-other-generic',
  accessoryother: 'accessory-other-proxy',
  grid: 'energy-grid-generic',
  solar: 'energy-solar-generic',
  wind: 'energy-wind-generic',
  coal: 'energy-coal-generic',
  gas: 'energy-gas-generic',
  mixedenergy: 'energy-mixed-generic',
  road: 'transport-road-defra-2025',
  sea: 'transport-sea-defra-2025',
  air: 'transport-air-defra-2025',
  rail: 'transport-rail-defra-2025',
  multimodal: 'transport-multimodal-proxy',
  knitting: 'process-knitting',
  weaving: 'process-weaving',
  cutting: 'process-cutting',
  cuttingsewing: 'process-cutting-sewing',
  genericgarment: 'process-generic-garment',
  dyeing: 'process-dyeing',
  printing: 'process-printing',
  finishing: 'process-finishing'
};

const CATEGORY_METHODOLOGY = {
  textile: {
    methodologyName: 'WeaveCarbon Attributional Textile PCF',
    methodologyVersion: 'WeaveCarbon Attributional Textile PCF v2.1 - climate-only partial CFP',
    calculationGraphVersion: 'textile-pcf-2.1.0',
    defaultProcessFactorId: 'process-generic-garment',
    defaultMaterialFactorId: 'cat-other-generic',
    processFallbackWarningLabel: 'garment'
  }
};

const MARKET_DISTANCE_DEFAULTS = {
  vietnam: 500,
  domestic: 500,
  vn: 500,
  eu: 10000,
  usa: 14000,
  us: 14000,
  japan: 3500,
  jp: 3500,
  korea: 3200,
  kr: 3200,
  china: 2500,
  cn: 2500,
  other: 5000
};

const resolveCarbonFactorId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (factors[raw]) return raw;
  return FACTOR_ID_ALIASES[normalizeToken(raw)];
};

const getCarbonFactor = (idOrAlias) => {
  const resolvedId = resolveCarbonFactorId(idOrAlias);
  return resolvedId ? factors[resolvedId] : undefined;
};

const resolveFactorOrFallback = (factorId, fallbackId) => {
  const factor = getCarbonFactor(factorId) || getCarbonFactor(fallbackId);
  if (!factor) throw new Error(`Unknown carbon factor and fallback: ${factorId} / ${fallbackId}`);
  return factor;
};

const resolveEnergyFactor = (factorId, geography) => {
  if (factorId) {
    const explicitFactor = getCarbonFactor(factorId);
    if (explicitFactor) return explicitFactor;
  }

  const normalizedGeography = String(geography || '').trim().toLowerCase();
  if (normalizedGeography === 'vietnam' || normalizedGeography === 'vn') {
    return getCarbonFactor('energy-grid-vn-2023') || getCarbonFactor('energy-grid-generic');
  }
  return getCarbonFactor('energy-grid-generic');
};

const resolveEnergyScope = (factor, reportingActorRole) => {
  if (reportingActorRole === 'brand') return 'scope3';
  if (factor.id.startsWith('energy-coal') || factor.id.startsWith('energy-gas')) return 'scope1';
  return 'scope2';
};

const resolveCategoryMethodology = (category) => CATEGORY_METHODOLOGY[category || 'textile'];

const resolveMarketDistanceDefault = (value) => {
  const key = normalizeToken(value);
  return MARKET_DISTANCE_DEFAULTS[key] || MARKET_DISTANCE_DEFAULTS.other;
};

const resolveAccessoryFactorIdByKeyword = (value) => {
  const key = normalizeToken(value);
  if (!key) return 'accessory-other-proxy';
  if (key.includes('button') || key.includes('nut')) return 'cat-button-plastic';
  if (key.includes('zipper') || key.includes('khoakeo')) return 'cat-zipper-plastic';
  if (key.includes('thread') || key.includes('chimay')) return 'cat-thread-polyester';
  if (key.includes('label') || key.includes('nhan')) return 'cat-label-woven';
  if (key.includes('elastic') || key.includes('thun')) return 'cat-elastic-band';
  if (key.includes('lining') || key.includes('lot')) return 'cat-lining-polyester';
  if (key.includes('padding') || key.includes('dem') || key.includes('mut')) {
    return 'cat-padding-polyester';
  }
  return 'accessory-other-proxy';
};

module.exports = {
  CATEGORY_METHODOLOGY,
  FACTOR_ID_ALIASES,
  MARKET_DISTANCE_DEFAULTS,
  getCarbonFactor,
  listCarbonFactors: () => Object.values(factors),
  resolveAccessoryFactorIdByKeyword,
  resolveCarbonFactorId,
  resolveCategoryMethodology,
  resolveEnergyFactor,
  resolveEnergyScope,
  resolveFactorOrFallback,
  resolveMarketDistanceDefault
};
