const { createAppError } = require('../shared/errors');
const { calculateCarbonFootprint } = require('./core');

const MATERIAL_FACTOR_BY_TYPE = {
  cotton: 'cat-cotton-100',
  organic_cotton: 'cat-cotton-organic',
  recycled_cotton: 'cat-cotton-recycled',
  polyester: 'cat-polyester-100',
  recycled_polyester: 'cat-polyester-recycled',
  wool: 'cat-wool-100',
  silk: 'cat-silk-100',
  linen: 'cat-linen-100',
  nylon: 'cat-nylon-100',
  bamboo: 'cat-bamboo',
  hemp: 'cat-hemp',
  tencel: 'cat-tencel',
  viscose: 'cat-viscose',
  blend: 'cat-blend-cotton-poly',
  mixed: 'cat-blend-cotton-poly'
};

const PROCESS_FACTOR_BY_TYPE = {
  knitting: 'process-knitting',
  weaving: 'process-weaving',
  cutting: 'process-cutting',
  cutting_sewing: 'process-cutting-sewing',
  dyeing: 'process-dyeing',
  printing: 'process-printing',
  finishing: 'process-finishing'
};

const TRANSPORT_FACTOR_BY_MODE = {
  road: 'transport-road-defra-2025',
  sea: 'transport-sea-defra-2025',
  air: 'transport-air-defra-2025',
  rail: 'transport-rail-defra-2025',
  multimodal: 'transport-multimodal-proxy'
};

const CLIENT_CARBON_OUTPUT_FIELDS = new Set([
  'carbonResults',
  'carbon_results',
  'perProduct',
  'per_product',
  'totalBatch',
  'total_batch',
  'biogenicCarbon',
  'biogenic_carbon',
  'gwpBreakdown',
  'gwp_breakdown',
  'cradleToGateCoreKgCO2e',
  'cradle_to_gate_core_kg_co2e',
  'gateToMarketExtensionKgCO2e',
  'gate_to_market_extension_kg_co2e',
  'reportedTotalKgCO2e',
  'reported_total_kg_co2e',
  'materialsCO2e',
  'materials_co2e',
  'productionCO2e',
  'production_co2e',
  'transportCO2e',
  'transport_co2e',
  'packagingCO2e',
  'packaging_co2e',
  'totalCO2e',
  'total_co2e',
  'co2PerUnit',
  'co2_per_unit',
  'unit_co2e',
  'confidenceLevel',
  'confidence_level',
  'confidenceScore',
  'confidence_score',
  'proxyUsed',
  'proxy_used',
  'proxyNotes',
  'proxy_notes',
  'co2eRange',
  'co2e_range',
  'methodologyVersion',
  'methodology_version',
  'assumptionsUsed',
  'assumptions_used',
  'factorSourceSummary',
  'factor_source_summary',
  'dataQualityBreakdown',
  'data_quality_breakdown',
  'quality',
  'uncertainty',
  'energyBreakdown',
  'energy_breakdown',
  'factorSources',
  'factor_sources',
  'warnings',
  'trace',
  'boundary',
  'stageBreakdown',
  'stage_breakdown',
  'scope1',
  'scope2',
  'scope3',
  'carbonInput',
  'carbon_input'
]);

const safeArray = (value) => Array.isArray(value) ? value : [];

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replace(/,/g, '.').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const resolveEnergyFactorId = (source, geography) => {
  const normalizedSource = normalizeText(source);
  const normalizedGeography = normalizeText(geography);

  if (normalizedSource === 'grid') {
    return normalizedGeography === 'vietnam' || normalizedGeography === 'vn'
      ? 'energy-grid-vn-2023'
      : 'energy-grid-generic';
  }
  if (normalizedSource === 'solar') return 'energy-solar-generic';
  if (normalizedSource === 'wind') return 'energy-wind-generic';
  if (normalizedSource === 'coal') return 'energy-coal-generic';
  if (normalizedSource === 'gas') return 'energy-gas-generic';
  if (normalizedSource === 'mixed') return 'energy-mixed-generic';
  return undefined;
};

const stripClientCarbonOutputs = (payload = {}) => Object.fromEntries(
  Object.entries(payload).filter(([key]) => !CLIENT_CARBON_OUTPUT_FIELDS.has(key))
);

const buildCarbonEngineInputFromAssessment = (payload = {}) => {
  const productCategory = payload.productCategory || payload.product_category || 'textile';
  const originAddress = payload.originAddress || payload.origin_address || {};
  const manufacturingGeography =
    payload.manufacturingLocation || payload.manufacturing_location || originAddress.country;
  const destinationMarket = normalizeText(
    payload.destinationMarket || payload.destination_market
  ) || 'other';
  const materials = safeArray(payload.materials);
  const accessories = safeArray(payload.accessories);
  const productionProcesses = safeArray(
    payload.productionProcesses || payload.production_processes || payload.processes
  );
  const energySources = safeArray(payload.energySources || payload.energy_sources);
  const transportLegs = safeArray(payload.transportLegs || payload.transport_legs);

  return {
    unitMassKg: Math.max(
      0,
      toNumber(payload.weightPerUnit ?? payload.weight_per_unit) / 1000
    ),
    quantity: Math.max(1, toNumber(payload.quantity)),
    reportingActorRole: 'manufacturer',
    productCategory,
    materials: materials.map((material) => {
      const materialType = String(
        material.materialType || material.material_type || material.type || ''
      );
      return {
        id: material.id,
        type: materialType,
        factorId: materialType.startsWith('cat-')
          ? materialType
          : MATERIAL_FACTOR_BY_TYPE[materialType],
        percentage: toNumber(material.percentage),
        source: material.source,
        name: materialType
      };
    }),
    accessories: accessories.map((accessory) => {
      const weight = accessory.weight ?? accessory.weightGram ?? accessory.weight_gram;
      return {
        id: accessory.id,
        type: accessory.type,
        name: accessory.name,
        weightKg: Number.isFinite(weight) ? weight / 1000 : undefined
      };
    }),
    packaging: null,
    includePackagingFallbackNote: false,
    processFactorIds: productionProcesses.map(
      (process) => PROCESS_FACTOR_BY_TYPE[process] || 'process-generic-garment'
    ),
    energyMix: energySources.map((energy) => {
      const normalizedEnergy = normalizeText(energy.source);
      const isRenewable = normalizedEnergy === 'solar' || normalizedEnergy === 'wind';
      const factorId = isRenewable && (energy.recsSold ?? energy.recs_sold)
        ? resolveEnergyFactorId('grid', manufacturingGeography)
        : resolveEnergyFactorId(energy.source, manufacturingGeography);
      return {
        factorId,
        percentage: toNumber(energy.percentage),
        geography: manufacturingGeography
      };
    }),
    manufacturingGeography,
    originGeography: originAddress.country,
    destinationMarket,
    transport: transportLegs.map((leg) => {
      const mode = leg.mode || leg.transport_mode;
      return {
        mode,
        factorId: TRANSPORT_FACTOR_BY_MODE[mode] || 'transport-multimodal-proxy',
        distanceKm: toNumber(
          leg.estimatedDistance ?? leg.estimated_distance ?? leg.distanceKm ?? leg.distance_km
        ) || undefined,
        defaultDistanceKey: destinationMarket,
        boundaryType: 'gate_to_market'
      };
    })
  };
};

const calculateAuthoritativeProductCarbon = (payload) => {
  try {
    const input = buildCarbonEngineInputFromAssessment(payload);
    return { input, result: calculateCarbonFootprint(input) };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw createAppError(error.message, {
      statusCode: 400,
      code: 'INVALID_CARBON_INPUT'
    });
  }
};

module.exports = {
  CLIENT_CARBON_OUTPUT_FIELDS,
  MATERIAL_FACTOR_BY_TYPE,
  PROCESS_FACTOR_BY_TYPE,
  TRANSPORT_FACTOR_BY_MODE,
  buildCarbonEngineInputFromAssessment,
  calculateAuthoritativeProductCarbon,
  resolveEnergyFactorId,
  stripClientCarbonOutputs
};
