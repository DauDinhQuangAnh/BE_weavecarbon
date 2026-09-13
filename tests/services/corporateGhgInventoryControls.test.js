const { SCOPE1_CATEGORIES, SCOPE2_CATEGORIES, GASES, evaluateCorporateGhgInventory,
  deriveCorporateGhgStatus } = require('../../src/services/corporateGhgInventoryControls');

const evidence1 = '10000000-0000-4000-8000-000000000001';
const evidence2 = '10000000-0000-4000-8000-000000000002';
const evidence = [evidence1, evidence2].map((id, index) => ({ id, type: index ? 'fuel_receipt' : 'electricity_bill',
  name: `source-${index}.pdf`, checksumSha256: String(index + 1).repeat(64), fileSizeBytes: 100, status: 'locked' }));
const decisions = (categories, quantified) => categories.map((category) => ({ category,
  status: quantified.includes(category) ? 'quantified' : 'not_relevant', rationale: quantified.includes(category) ? 'Source data included.' : 'Screened and not relevant.' }));
const input = {
  inventoryReference: 'GHG-2026', inventoryDate: '2026-09-13', reportingEntityName: 'Example Company',
  reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-12-31', intendedUse: 'Internal management reporting',
  organizationalBoundary: { approach: 'operational_control', description: 'All controlled operations.',
    entities: [{ reference: 'ENTITY-1', name: 'Example Company', ownershipPercent: 100, included: true, rationale: 'Parent entity.' }] },
  facilities: [{ reference: 'FAC-1', name: 'Main Facility', country: 'VN', included: true,
    rationale: 'Under operational control.', evidenceDocumentIds: [evidence1] }], defaultFuelFacilityReference: 'FAC-1',
  operationalBoundary: { scope1: decisions(SCOPE1_CATEGORIES, ['stationary_combustion']),
    scope2: decisions(SCOPE2_CATEGORIES, ['purchased_electricity']), scope3Claim: 'not_included', scope3: [] },
  gasCoverage: GASES.map((gas) => ({ gas, status: gas === 'CO2' ? 'quantified' : 'not_relevant', rationale: gas === 'CO2' ? 'CO2e factors applied.' : 'Screened and not relevant.' })),
  baseYear: { year: 2025, emissionsKgCo2e: null, recalculationPolicy: 'Recalculate for structural changes above threshold.',
    significanceThresholdPercent: 5, structuralChanges: 'None.' },
  scope2Accounting: { marketBasedApplicable: false, locationBasedFactorVersion: 'Vietnam grid EF 2023',
    gwpBasis: 'IPCC AR6 100-year', marketBasedMethod: '', contractualInstrumentEvidenceIds: [] },
  fuelFactorMetadata: [{ fuelType: 'diesel', source: 'DEFRA conversion factors', version: '2025', gwpBasis: 'IPCC AR6 100-year' }],
  additionalSources: [], dataCompletenessPercent: 100, dataQualityAssessment: 'Source, period and factor quality reviewed.',
  dataImprovementPlan: 'Replace estimates with meter data.', uncertaintyAssessment: 'Qualitative factor and meter uncertainty review.',
  biogenicCo2Kg: 0, removalsCo2Kg: 0, offsetsRetiredKgCo2e: 20, exclusions: [], evidenceDocumentIds: [evidence1, evidence2],
  assurance: { verifiedLanguageRequested: false, providerName: '', level: '', statementDate: null, evidenceDocumentId: null },
  limitations: 'Scope 3 is not included. Internal Scope 1 and Scope 2 inventory only.'
};
const activity = [
  { sourceType: 'electricity_invoice', sourceReference: 'ELEC-1', facilityReference: 'FAC-1', scope: 'scope2',
    category: 'purchased_electricity', gas: 'CO2e', accountingMethod: 'location_based', activityValue: 1000,
    activityUnit: 'kWh', emissionFactor: 0.4, factorUnit: 'kg CO2e/kWh', factorSource: 'Vietnam grid EF',
    factorVersion: '2023', gwpBasis: 'IPCC AR6 100-year', calculatedCo2eKg: 400, reportedCo2eKg: 400,
    recordStatus: 'verified', evidenceDocumentIds: [evidence1] },
  { sourceType: 'fuel_invoice', sourceReference: 'FUEL-1', facilityReference: 'FAC-1', scope: 'scope1',
    category: 'stationary_combustion', gas: 'CO2e', accountingMethod: 'location_based', activityValue: 100,
    activityUnit: 'L', emissionFactor: 2.5, factorUnit: 'kg CO2e/L', factorSource: 'DEFRA conversion factors',
    factorVersion: '2025', gwpBasis: 'IPCC AR6 100-year', calculatedCo2eKg: 250, reportedCo2eKg: 250,
    recordStatus: 'reviewed', fuelType: 'diesel', evidenceDocumentIds: [evidence2] }
];

describe('R13 corporate GHG inventory controls', () => {
  test('reproduces gross Scope 1 and location-based Scope 2 without netting offsets', () => {
    const evaluated = evaluateCorporateGhgInventory(input, activity, evidence);
    expect(evaluated.result.automatedStatus).toBe('inventory_review_required');
    expect(evaluated.result.totals).toMatchObject({ scope1KgCo2e: 250, scope2LocationBasedKgCo2e: 400,
      grossScope1AndLocationScope2KgCo2e: 650, offsetsRetiredKgCo2e: 20 });
    expect(evaluated.result.inventoryScopeLabel).toBe('Internal Scope 1 and Scope 2 inventory');
  });

  test('blocks missing source categories, unreviewed activity and non-reproducible totals', () => {
    const broken = evaluateCorporateGhgInventory({ ...input,
      operationalBoundary: { ...input.operationalBoundary, scope1: input.operationalBoundary.scope1.slice(0, 3) } },
    [{ ...activity[0], recordStatus: 'uploaded', reportedCo2eKg: 999 }], evidence);
    const codes = broken.result.findings.map((item) => item.code);
    expect(broken.result.automatedStatus).toBe('needs_information');
    expect(codes).toEqual(expect.arrayContaining(['GHG_OPERATIONAL_BOUNDARY_INCOMPLETE', 'GHG_ACTIVITY_SOURCE_NOT_REVIEWED',
      'GHG_ACTIVITY_NOT_REPRODUCIBLE', 'GHG_QUANTIFIED_CATEGORY_HAS_NO_SOURCE']));
  });

  test('requires dual Scope 2 inputs and authentic assurance evidence when claimed', () => {
    const claimed = evaluateCorporateGhgInventory({ ...input,
      scope2Accounting: { ...input.scope2Accounting, marketBasedApplicable: true },
      assurance: { verifiedLanguageRequested: true, providerName: 'Verifier', level: 'limited_assurance',
        statementDate: '2026-09-13', evidenceDocumentId: evidence1 } }, activity, evidence);
    const codes = claimed.result.findings.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['GHG_SCOPE2_DUAL_REPORTING_INCOMPLETE', 'GHG_ASSURANCE_INVALID']));
    expect(claimed.result.assuranceStatus).toBe('not_independently_verified');
  });

  test('reopens an approved inventory when bound evidence bytes drift', () => {
    const evaluated = evaluateCorporateGhgInventory(input, activity, evidence);
    const inventory = { result: evaluated.result, latestReview: { decision: 'approved_for_internal_report', evidenceSnapshot: evidence } };
    expect(deriveCorporateGhgStatus(inventory, evidence).status).toBe('approved_for_internal_report');
    expect(deriveCorporateGhgStatus(inventory, evidence.map((item, index) => index ? item : { ...item, checksumSha256: 'f'.repeat(64) })).status)
      .toBe('evidence_review_required');
  });
});
