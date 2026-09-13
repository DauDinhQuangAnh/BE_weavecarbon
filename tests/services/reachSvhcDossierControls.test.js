const { RULESET, evaluateReachDossier, deriveReachReleaseStatus } = require('../../src/services/reachSvhcDossierControls');

const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidence = [{ id: evidenceId, type: 'reach_lab_report', name: 'lab.pdf', checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked' }];
const validInput = (substancePatch = {}, rootPatch = {}) => ({
  dossierReference: 'REACH-1', assessmentDate: '2026-09-13', productReference: 'SKU-1', productName: 'Cotton shirt',
  articleCategory: 'consumer clothing', consumerArticle: true, placedOnEuMarket: true, marketCodes: ['DE'],
  euActorRole: 'importer', articleLevelAssessmentConfirmed: true, candidateListSnapshotDate: '2026-02-04',
  candidateListEntryCount: 253, reachConsolidatedDate: '2026-06-22',
  components: [{ componentReference: 'button', componentName: 'Button', articleReference: 'BUTTON-1',
    homogeneousMaterialReference: 'PLASTIC-1', materialName: 'Polyester resin', materialLocation: 'Front closure',
    substances: [{ substanceName: 'n-hexane', casNumber: '110-54-3', candidateListStatus: 'included',
      candidateInclusionDate: '2026-02-04', concentrationPercentWw: 0.2, annualTonnage: 0.2, location: 'Button resin',
      evidenceBasis: 'laboratory_test', detectionLimit: 0.01, detectionLimitUnit: 'percent_w_w',
      safeUseInstructions: [{ marketCode: 'DE', languageCode: 'de-DE', text: 'Nicht verbrennen.', operatorApproved: true }],
      article7Exemption: 'none', article7ExemptionRationale: '', evidenceDocumentIds: [evidenceId],
      restrictionAssessments: [{ entryNumber: '72', scopeDecision: 'not_applies', scopeRationale: 'Substance is not listed in Appendix 12.',
        legalLimit: null, limitUnit: '', measuredValue: null, prohibitedWhen: '', testMethod: '',
        exemptionClaimed: false, exemptionRationale: '', evidenceDocumentIds: [evidenceId] }], ...substancePatch }] }],
  supplierDeclarationEvidenceIds: [evidenceId], notes: '', ...rootPatch
});

describe('R11 REACH/SVHC dossier controls', () => {
  test('derives Article 33, consumer and SCIP duties without a generic certificate claim', () => {
    const result = evaluateReachDossier(validInput(), evidence).result;
    expect(result.rulesetVersion).toBe(RULESET.version);
    expect(result.automatedStatus).toBe('ready_for_chemical_review');
    expect(result.obligations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ARTICLE_33_COMMUNICATION_REQUIRED', 'CONSUMER_RESPONSE_WITHIN_45_DAYS', 'SCIP_NOTIFICATION_ASSESSMENT_REQUIRED'
    ]));
    expect(result.disclaimer).toContain('not legal advice');
    expect(result.disclaimer).toContain('generic REACH certificate');
  });

  test('blocks a restriction result that reaches its legal limit', () => {
    const input = validInput({ substanceName: 'formaldehyde', casNumber: '50-00-0', candidateListStatus: 'not_included',
      concentrationPercentWw: 0.01, safeUseInstructions: [], restrictionAssessments: [{ entryNumber: '72', scopeDecision: 'applies', scopeRationale: 'Consumer textile homogeneous material.',
      legalLimit: 10, limitUnit: 'mg_kg_material', measuredValue: 10, prohibitedWhen: 'at_or_above_limit', testMethod: 'Method', exemptionClaimed: false,
      evidenceDocumentIds: [evidenceId] }] });
    const result = evaluateReachDossier(input, evidence).result;
    expect(result.automatedStatus).toBe('needs_information');
    expect(result.findings.map((item) => item.code)).toContain('ANNEX_XVII_LIMIT_REACHED_OR_EXCEEDED');
  });

  test('requires current source versions and article-level assessment', () => {
    const result = evaluateReachDossier(validInput({}, { articleLevelAssessmentConfirmed: false, candidateListEntryCount: 252 }), evidence).result;
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ARTICLE_LEVEL_ASSESSMENT_REQUIRED', 'CHEMICAL_SOURCE_VERSION_MISMATCH'
    ]));
  });

  test('adds Article 7 assessment above one tonne and validates exemption evidence', () => {
    const result = evaluateReachDossier(validInput({ annualTonnage: 2, article7Exemption: '' }), evidence).result;
    expect(result.obligations.map((item) => item.code)).toContain('ARTICLE_7_NOTIFICATION_ASSESSMENT_REQUIRED');
    expect(result.findings.map((item) => item.code)).toContain('ARTICLE_7_EXEMPTION_DECISION_REQUIRED');
  });

  test('detects checksum drift after named approval', () => {
    const evaluated = evaluateReachDossier(validInput(), evidence);
    const dossier = { result: evaluated.result, latestReview: { decision: 'approved_for_internal_release', evidenceSnapshot: evidence } };
    expect(deriveReachReleaseStatus(dossier, evidence).status).toBe('approved_for_internal_release');
    expect(deriveReachReleaseStatus(dossier, [{ ...evidence[0], checksumSha256: 'b'.repeat(64) }]).status).toBe('evidence_review_required');
  });
});
