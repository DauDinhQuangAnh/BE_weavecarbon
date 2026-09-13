const { RULESET, evaluatePcfStudy, derivePcfStudyStatus } = require('../../src/services/pcfStudyControls');
const { calculateCarbonFootprint } = require('../../src/modules/carbon/core');
const carbonInput = require('../fixtures/carbon/v1/inputs.json').cases[0].input;

const snapshotId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidence = [{ id: evidenceId, type: 'pcf_source', name: 'source.pdf', checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked' }];
const result = calculateCarbonFootprint(carbonInput);
const snapshot = { id: snapshotId, version: 2, is_legacy: false, finalized_at: '2026-09-13T00:00:00Z',
  canonical_input_hash: 'b'.repeat(64), engine_version: result.trace.ruleEngineVersion,
  methodology_version: result.methodologyVersion, factor_registry_version: 'registry-v1', gwp_basis: result.methodology.gwpBasis,
  factor_snapshot: result.factorSourceSummary, payload: { carbonInput, carbonResults: result } };
const validInput = (patch = {}) => ({
  studyReference: 'PCF-1', studyDate: '2026-09-13', calculationSnapshotId: snapshotId,
  productReference: 'SKU-1', productName: 'Cotton shirt', reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-08-31',
  intendedApplication: 'Internal buyer data review', intendedAudience: 'Buyer sustainability team', comparativeAssertion: false,
  functionalUnit: { quantity: 1, unit: 'piece', description: 'One finished shirt delivered to the EU market' },
  referenceFlow: { amount: 0.5, unit: 'kg finished product', basis: 'Measured unit mass' },
  boundaryType: 'cradle_to_gate_plus_gate_to_market_extension',
  includedStages: ['materials', 'finished_goods_manufacturing', 'packaging', 'logistics_and_storage'],
  processMap: [{ processReference: 'MAT-1', processName: 'Materials', stage: 'materials', included: true,
    dataSource: 'Supplier and calculation records', evidenceDocumentIds: [evidenceId] }],
  excludedProcesses: [{ processName: 'Use phase', rationale: 'Partial CFP boundary', estimatedImpactPercent: 0 }],
  cutoff: { massPercent: 1, energyPercent: 1, environmentalSignificanceApplied: true, rationale: 'No significant process omitted.' },
  pcr: { status: 'not_identified', name: '', publisher: '', version: '', validFrom: null, validTo: null,
    rationale: 'No current product-specific PCR identified; practitioner confirmation required.' },
  allocation: { required: false, method: '', rationale: 'No multifunctional process modeled.', hierarchyJustification: '',
    sensitivityPerformed: false, sensitivitySummary: '' },
  recyclingModel: { method: 'cut-off', rationale: 'Recycled input burden follows the factor dataset; end of life is excluded.' },
  dataQualityAssessment: 'Review technological, geographical, temporal, completeness and reliability scores.',
  dataImprovementPlan: 'Replace material and transport proxies with supplier-specific primary data.',
  uncertaintyAssessment: { method: 'rss_fallback', parameter: 'Factor and activity uncertainty.', scenario: 'Boundary and transport scenario uncertainty.',
    model: 'RSS fallback is not Monte Carlo.', sensitivityScenarios: ['Replace proxy factors', 'Vary transport distance'] },
  landUseChangeMethod: 'Not modeled; disclosed separately as unavailable.',
  biogenicCarbonTreatment: 'Reported separately and not netted against fossil GWP.', evidenceDocumentIds: [evidenceId],
  externalAssuranceRecordId: null, limitations: 'Climate-only partial CFP. Use and end-of-life excluded.', notes: '', ...patch
});

describe('R12 PCF study controls', () => {
  test('binds a reproducible calculation and current standard status', () => {
    const evaluated = evaluatePcfStudy(validInput(), snapshot, evidence).result;
    expect(evaluated.rulesetVersion).toBe(RULESET.version);
    expect(evaluated.calculation.reportedTotalKgCO2e).toBe(evaluated.calculation.reproducedTotalKgCO2e);
    expect(evaluated.automatedStatus).toBe('practitioner_review_required');
    expect(evaluated.claimStatus).toBe('not_independently_verified');
  });

  test('blocks client totals that do not reproduce from stored AD x EF terms', () => {
    const bad = { ...snapshot, payload: { ...snapshot.payload,
      carbonResults: { ...snapshot.payload.carbonResults, reportedTotalKgCO2e: 999 } } };
    const evaluated = evaluatePcfStudy(validInput(), bad, evidence).result;
    expect(evaluated.findings.map((item) => item.code)).toContain('PCF_CALCULATION_NOT_REPRODUCIBLE');
  });

  test('requires allocation sensitivity when allocation is used', () => {
    const evaluated = evaluatePcfStudy(validInput({ allocation: { required: true, method: 'mass', rationale: 'Shared process.',
      hierarchyJustification: 'Subdivision was not feasible.', sensitivityPerformed: false, sensitivitySummary: '' } }), snapshot, evidence).result;
    expect(evaluated.findings.map((item) => item.code)).toContain('PCF_ALLOCATION_INCOMPLETE');
  });

  test('blocks comparative assertions without an assurance or critical review record', () => {
    const evaluated = evaluatePcfStudy(validInput({ comparativeAssertion: true }), snapshot, evidence).result;
    expect(evaluated.findings.map((item) => item.code)).toContain('PCF_COMPARATIVE_ASSERTION_BLOCKED');
  });

  test('detects calculation supersession and evidence drift after approval', () => {
    const evaluated = evaluatePcfStudy(validInput(), snapshot, evidence);
    const study = { result: evaluated.result, latestReview: { decision: 'approved_for_internal_report', evidenceSnapshot: evidence } };
    expect(derivePcfStudyStatus(study, evidence, snapshotId).status).toBe('approved_for_internal_report');
    expect(derivePcfStudyStatus(study, evidence, '60000000-0000-4000-8000-000000000001').status).toBe('calculation_superseded');
    expect(derivePcfStudyStatus(study, [{ ...evidence[0], checksumSha256: 'c'.repeat(64) }], snapshotId).status).toBe('evidence_review_required');
  });
});
