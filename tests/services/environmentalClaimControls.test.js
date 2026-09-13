const {
  RULESET, evaluateEnvironmentalClaim, derivePublicationStatus
} = require('../../src/services/environmentalClaimControls');

const SHA = 'a'.repeat(64);
const evidence = [{
  id: '11111111-1111-4111-8111-111111111111', status: 'locked',
  checksumSha256: 'b'.repeat(64), fileSizeBytes: 123, validTo: '2027-12-31'
}];
const validClaim = (patch = {}) => ({
  claimReference: 'CLAIM-001', exactClaimText: 'This shirt uses 20% less cradle-to-gate CO2e than baseline X.',
  publicCommunication: true, channel: 'website', marketCodes: ['DE'], languageCode: 'de-DE',
  communicationStart: '2026-09-27', communicationEnd: '2027-06-30',
  subjectType: 'sku', subjectReference: 'SKU-001', scopeStatement: 'One shirt SKU and cradle-to-gate boundary.',
  claimKind: 'specific_environmental', specificationText: '20% versus 2025 SKU baseline X, cradle-to-gate.',
  claimScopeMode: 'specific_aspect', actualCoverage: 'aspect_only',
  methodology: { standard: 'internal PCF method', version: '1.0', calculationSha256: SHA, datasetReferences: ['dataset-v1'], factorReferences: ['factor-v1'] },
  comparison: { baseline: '', comparator: '', sameMethodAndScope: false },
  futureCommitment: { implementationPlanUrl: '', milestones: [], independentMonitoring: false },
  labelScheme: { schemeType: 'other', schemeName: '', publicCriteriaUrl: '' },
  limitations: ['Supplier data coverage 90%'], exclusions: ['Use phase'],
  uncertaintyStatement: 'Estimated uncertainty ±15%.', qualifiers: ['Cradle-to-gate only'],
  updateTriggers: ['calculation changes'], withdrawalTriggers: ['evidence expires'],
  evidenceDocumentIds: evidence.map((item) => item.id), notes: 'Legal review required.', ...patch
});

describe('R18 environmental claim controls', () => {
  test('builds a versioned, checksum-bound dossier ready for legal review', () => {
    const result = evaluateEnvironmentalClaim(validClaim(), evidence);
    expect(result.result.rulesetVersion).toBe(RULESET.version);
    expect(result.result.automatedStatus).toBe('ready_for_legal_review');
    expect(result.result.amendedRulesApply).toBe(true);
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.result.resultSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    ['generic_environmental', {}, 'GENERIC_CLAIM_RECOGNISED_PERFORMANCE_REQUIRED'],
    ['offset_based_product_climate', {}, 'OFFSET_BASED_PRODUCT_CLIMATE_CLAIM'],
    ['legal_requirement_feature', {}, 'LEGAL_REQUIREMENT_AS_DISTINCTIVE_FEATURE'],
    ['sustainability_label', { labelScheme: { schemeType: 'self_declared' } }, 'SUSTAINABILITY_LABEL_SCHEME_REQUIRED']
  ])('blocks prohibited %s claims from the application date', (claimKind, patch, code) => {
    const result = evaluateEnvironmentalClaim(validClaim({ claimKind, ...patch }), evidence);
    expect(result.result.automatedStatus).toBe('blocked_prohibited');
    expect(result.result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code, severity: 'prohibited' })]));
  });

  test('requires comparison equivalence and a monitored plan for conditional claims', () => {
    const comparison = evaluateEnvironmentalClaim(validClaim({ claimKind: 'comparative' }), evidence);
    const future = evaluateEnvironmentalClaim(validClaim({ claimKind: 'future_performance' }), evidence);
    expect(comparison.result.automatedStatus).toBe('needs_information');
    expect(comparison.result.findings.some((item) => item.code === 'COMPARISON_BASIS_INCOMPLETE')).toBe(true);
    expect(future.result.findings.some((item) => item.code === 'FUTURE_COMMITMENT_PLAN_INCOMPLETE')).toBe(true);
  });

  test('derives current approval then invalidates changed or expired evidence', () => {
    const evaluated = evaluateEnvironmentalClaim(validClaim(), evidence);
    const dossier = {
      input: evaluated.input, result: evaluated.result,
      latestReview: { decision: 'approved_for_publication', evidenceSnapshot: evidence }
    };
    expect(derivePublicationStatus(dossier, evidence, '2026-10-01').status).toBe('approved_current');
    expect(derivePublicationStatus(dossier, [{ ...evidence[0], checksumSha256: 'c'.repeat(64) }], '2026-10-01'))
      .toEqual({ status: 'evidence_review_required', staleEvidenceIds: [evidence[0].id] });
    expect(derivePublicationStatus(dossier, evidence, '2028-01-01').status).toBe('evidence_review_required');
    const nonExpiringEvidence = evidence.map((item) => ({ ...item, validTo: null }));
    expect(derivePublicationStatus({
      ...dossier, latestReview: { ...dossier.latestReview, evidenceSnapshot: nonExpiringEvidence }
    }, nonExpiringEvidence, '2028-01-01').status).toBe('expired');
  });

  test('does not call an unlocked or invalid evidence set ready', () => {
    const result = evaluateEnvironmentalClaim(validClaim(), [{ ...evidence[0], status: 'uploaded' }]);
    expect(result.result.automatedStatus).toBe('needs_information');
    expect(result.result.findings.some((item) => item.code === 'CLAIM_EVIDENCE_NOT_CONTROLLED')).toBe(true);
  });

  test('does not apply the 2026 blacklist before its application date', () => {
    const result = evaluateEnvironmentalClaim(validClaim({
      claimKind: 'offset_based_product_climate', communicationStart: '2026-09-01'
    }), evidence);
    expect(result.result.automatedStatus).toBe('ready_for_legal_review');
    expect(result.result.findings.some((item) => item.code === 'PRE_APPLICATION_DATE_REVIEW')).toBe(true);
  });
});
