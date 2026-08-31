const { CORE_STAGE_KEYS, aggregateCarbon } = require('./aggregation');
const { resolveCategoryMethodology } = require('./factorRegistry');
const {
  dedupeMessages,
  isFiniteNumber,
  normalizeCarbonInput,
  roundPerProduct
} = require('./normalization');
const { calculateDataQuality } = require('./quality');
const {
  calculateManufacturing,
  calculateMaterials,
  calculatePackaging,
  calculateTransport
} = require('./stages');
const { buildRssUncertainty } = require('./uncertainty');
const { assertValidCarbonInput } = require('./validation');

const RULE_ENGINE_VERSION = 'scope-quality-rss-1.0.0';

const calculateCarbonFootprint = (rawInput) => {
  assertValidCarbonInput(rawInput);
  const input = normalizeCarbonInput(rawInput);
  const warnings = [
    'This result is an attributional, climate-only partial CFP estimate for decision support.',
    'This result is not a comparative claim, product label, ISO certification, or third-party verification statement.'
  ];
  const quantity = isFiniteNumber(input.quantity) && input.quantity > 0 ? input.quantity : 1;
  const unitMassKg = isFiniteNumber(input.unitMassKg) ? Math.max(0, input.unitMassKg) : 0;
  const reportingActorRole = input.reportingActorRole || 'manufacturer';
  const methodology = resolveCategoryMethodology(input.productCategory);

  const materials = calculateMaterials({ input, unitMassKg, methodology });
  const packaging = calculatePackaging({ input });
  const manufacturing = calculateManufacturing({
    input,
    unitMassKg,
    methodology,
    reportingActorRole
  });
  const transport = calculateTransport({
    input,
    unitMassKg,
    packagingMassKg: packaging.packagingMassKg
  });

  const stages = {
    materials: materials.stage,
    finished_goods_manufacturing: manufacturing.stage,
    packaging: packaging.stage,
    logistics_and_storage: transport.stage
  };
  const contributionTerms = [
    ...materials.contributionTerms,
    ...packaging.contributionTerms,
    ...manufacturing.contributionTerms,
    ...transport.contributionTerms
  ];
  const notes = [
    ...materials.notes,
    ...packaging.notes,
    ...manufacturing.notes,
    ...transport.notes
  ];
  const aggregation = aggregateCarbon({ stages, quantity });
  const uncertainty = buildRssUncertainty(contributionTerms, aggregation.perProduct.total);
  const quality = calculateDataQuality({
    input,
    unitMassKg,
    bomCoverage: materials.bomCoverage,
    unknownMaterialOriginCount: materials.unknownMaterialOriginCount,
    processFactorIds: manufacturing.processFactorIds,
    energyEntries: manufacturing.energyEntries,
    manufacturingGeography: manufacturing.manufacturingGeography,
    transportEntries: transport.transportEntries,
    contributionTerms,
    uncertainty
  });
  const biogenicCarbonKgCO2e = materials.biogenicCarbonKgCO2e;
  const scope1Amount = manufacturing.scopes.scope1;
  const scope2Amount = manufacturing.scopes.scope2;
  const scope3Amount =
    materials.scope3Amount +
    packaging.scope3Amount +
    manufacturing.scopes.scope3 +
    transport.scope3Amount;

  return {
    perProduct: aggregation.perProduct,
    totalBatch: aggregation.totalBatch,
    biogenicCarbon: biogenicCarbonKgCO2e > 0
      ? {
          removedKgCO2e: roundPerProduct(biogenicCarbonKgCO2e),
          note: 'Biogenic CO2 stored in bio-based materials (e.g. wood), reported separately per GHG Protocol/PAS 2050 convention. Not included in perProduct.total or reportedTotalKgCO2e.'
        }
      : null,
    gwpBreakdown: {
      fossilKgCO2e: aggregation.perProduct.total,
      biogenicRemovedKgCO2e:
        biogenicCarbonKgCO2e > 0 ? roundPerProduct(biogenicCarbonKgCO2e) : 0,
      lulucKgCO2e: null,
      note: 'GHG separated per ISO 14067 (6.4.9) / EN 16485: fossilKgCO2e is the reported PCF total; biogenicRemovedKgCO2e is reported separately and never netted into it; lulucKgCO2e (land-use change) is not yet modeled for this cradle-to-gate + gate-to-market boundary.'
    },
    cradleToGateCoreKgCO2e: aggregation.cradleToGateCoreKgCO2e,
    gateToMarketExtensionKgCO2e: aggregation.gateToMarketExtensionKgCO2e,
    reportedTotalKgCO2e: aggregation.perProduct.total,
    confidenceLevel: quality.confidenceLevel,
    confidenceScore: quality.confidenceScore,
    proxyUsed: quality.proxyShare > 0 || notes.length > 0,
    proxyNotes: dedupeMessages(notes),
    scope1: roundPerProduct(scope1Amount),
    scope2: roundPerProduct(scope2Amount),
    scope3: roundPerProduct(scope3Amount),
    co2eRange: {
      min: uncertainty.p5KgCO2e,
      max: uncertainty.p95KgCO2e
    },
    methodologyVersion: methodology.methodologyVersion,
    methodology: {
      name: methodology.methodologyName,
      methodologyVersion: methodology.methodologyVersion,
      standardsAlignment: ['GHG Product Standard', 'ISO 14067', 'ISO 14040', 'ISO 14044'],
      impactCategory: 'climate_change_only',
      inventoryType: 'partial_cfp',
      boundaryType: 'cradle_to_gate_plus_gate_to_market_extension',
      gwpBasis: 'IPCC_AR5_100y',
      reportingActorRole
    },
    boundary: {
      includedStages: [...CORE_STAGE_KEYS],
      excludedStages: ['use', 'end_of_life'],
      partialCfp: true
    },
    quality: quality.quality,
    uncertainty,
    energyBreakdown: manufacturing.energyBreakdown,
    factorSources: aggregation.factorSourceSummary,
    warnings: dedupeMessages([...warnings, ...materials.warnings]),
    trace: {
      factorManifest: aggregation.factorManifest,
      calculationGraphVersion: methodology.calculationGraphVersion,
      ruleEngineVersion: RULE_ENGINE_VERSION
    },
    assumptionsUsed: dedupeMessages([
      'Boundary: climate-only partial CFP with cradle-to-gate core and gate-to-market extension.',
      'Manufacturing energy is modeled as a process input inside finished goods manufacturing.',
      'Uncertainty range uses WeaveCarbon internal RSS fallback, not Monte Carlo.',
      ...(biogenicCarbonKgCO2e > 0
        ? ['Biogenic CO2 from bio-based materials is reported separately from the fossil CO2e total, not netted into it.']
        : []),
      ...notes
    ]),
    factorSourceSummary: aggregation.factorSourceSummary,
    dataQualityBreakdown: quality.dataQualityBreakdown,
    stageBreakdown: aggregation.stageBreakdown
  };
};

module.exports = { RULE_ENGINE_VERSION, calculateCarbonFootprint };
