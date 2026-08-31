const crypto = require('crypto');
const expectedFixtures = require('../../../fixtures/carbon/v1/expected.json');
const inputFixtures = require('../../../fixtures/carbon/v1/inputs.json');
const factorRegistry = require('../../../../src/modules/carbon/core/factors.v1.json');
const {
  RULE_ENGINE_VERSION,
  calculateCarbonFootprint,
  listCarbonFactors,
  resolveCategoryMethodology
} = require('../../../../src/modules/carbon/core');

const projectGoldenResult = (result) => ({
  perProduct: result.perProduct,
  totalBatch: result.totalBatch,
  boundaryTotals: {
    cradleToGateCoreKgCO2e: result.cradleToGateCoreKgCO2e,
    gateToMarketExtensionKgCO2e: result.gateToMarketExtensionKgCO2e,
    reportedTotalKgCO2e: result.reportedTotalKgCO2e
  },
  scopes: {
    scope1: result.scope1,
    scope2: result.scope2,
    scope3: result.scope3
  },
  co2eRange: result.co2eRange,
  confidence: {
    level: result.confidenceLevel,
    score: result.confidenceScore,
    proxyUsed: result.proxyUsed
  },
  quality: result.quality,
  uncertainty: result.uncertainty,
  dataQualityBreakdown: result.dataQualityBreakdown,
  energyBreakdown: result.energyBreakdown.map(({ factorId, amount, scope }) => ({
    factorId,
    amount,
    scope
  })),
  stages: result.stageBreakdown.map((stage) => ({
    stage: stage.stage,
    amount: stage.amount,
    range: stage.range,
    quality: stage.quality,
    isEstimated: stage.isEstimated,
    factorIds: stage.factors.map((factor) => factor.factorId)
  })),
  factors: result.factorSourceSummary.map((factor) => ({
    factorId: factor.factorId,
    factorVersionId: factor.factorVersionId,
    value: factor.value,
    uncertaintyCv: factor.uncertaintyCv,
    quality: factor.quality,
    isProxy: factor.isProxy
  })),
  trace: result.trace,
  proxyNotes: result.proxyNotes
});

describe('WP-CARB2 backend calculation parity', () => {
  const expectedById = new Map(
    expectedFixtures.cases.map((fixture) => [fixture.id, fixture.expected])
  );

  test('fixture metadata is pinned to the active backend engine and methodology', () => {
    const methodology = resolveCategoryMethodology('textile');

    expect(inputFixtures.fixtureVersion).toBe('carbon-golden-v1');
    expect(expectedFixtures.fixtureVersion).toBe(inputFixtures.fixtureVersion);
    expect(inputFixtures.engineVersion).toBe(RULE_ENGINE_VERSION);
    expect(inputFixtures.methodologyVersion).toBe(methodology.methodologyVersion);
    expect(inputFixtures.cases).toHaveLength(5);
    expect(expectedFixtures.cases).toHaveLength(inputFixtures.cases.length);
  });

  test('factor registry contains the complete immutable V1 factor set', () => {
    const factors = listCarbonFactors();
    expect(factors).toHaveLength(64);
    expect(new Set(factors.map((factor) => factor.id)).size).toBe(factors.length);
    expect(factors.every((factor) => factor.factorVersionId.endsWith(':v1'))).toBe(true);
    expect(
      crypto.createHash('sha256').update(JSON.stringify(factorRegistry)).digest('hex').toUpperCase()
    ).toBe('29B1E378F5B1646E73CF6B693EBEC00868F5A8DF4209EFE49B5A33A5FC4F71E5');
  });

  test.each(inputFixtures.cases)('$id matches the WP-CARB1 golden result exactly', (fixture) => {
    expect(projectGoldenResult(calculateCarbonFootprint(fixture.input))).toEqual(
      expectedById.get(fixture.id)
    );
  });
});
