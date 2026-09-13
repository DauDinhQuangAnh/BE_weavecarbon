const {
  RULESET, evaluateGpsrTechnicalFile, deriveSafetyFileStatus
} = require('../../src/services/gpsrTechnicalFileControls');

const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidence = [{
  id: evidenceId, type: 'gpsr_test_report', name: 'gpsr-pack.pdf',
  checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked'
}];
const validInput = (overrides = {}) => ({
  fileReference: 'GPSR-SHIRT-1', assessmentDate: '2026-09-13', firstPlacedOnMarketDate: '2026-09-13',
  consumerProduct: true, placedOnEuMarket: true, marketCodes: ['DE'], harmonisationCoverage: 'none',
  applicableSectorRules: [],
  product: {
    brand: 'WeaveCarbon', name: 'Cotton shirt', model: 'WC-1', type: 'shirt', batchNumber: 'B-1',
    description: 'Adult cotton shirt', essentialCharacteristics: 'Woven cotton, buttons and seams', composition: '100% cotton',
    packagingDescription: 'Paper sleeve', productImageEvidenceId: evidenceId, packagingImageEvidenceId: evidenceId
  },
  intendedUse: 'Adult upper-body garment', foreseeableMisuse: 'Use near an open flame', vulnerableGroups: ['adults'],
  operators: {
    manufacturer: { name: 'Maker VN', postalAddress: 'HCMC, Vietnam', electronicAddress: 'safety@maker.vn', euEstablished: false },
    importer: { name: 'Importer GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'safety@importer.de', euEstablished: true },
    responsiblePerson: { name: 'EU Safety GmbH', postalAddress: 'Berlin, Germany', electronicAddress: 'gpsr@safety.de', euEstablished: true }
  },
  risks: [{
    hazardId: 'H-1', hazardCategory: 'mechanical', hazardDescription: 'Loose button may be swallowed',
    affectedGroups: ['children'], foreseeableScenario: 'Detached button reaches a child', likelihood: 2, severity: 3,
    mitigation: 'Pull testing and seam inspection', residualLikelihood: 1, residualSeverity: 3,
    verificationEvidenceIds: [evidenceId]
  }],
  standards: [{ reference: 'INTERNAL-BUTTON-PULL', title: 'Button pull test', version: '1', applicationExtent: 'full' }],
  warnings: [{ marketCode: 'DE', languageCode: 'de-DE', text: 'Von offenem Feuer fernhalten.', location: 'packaging', operatorApproved: true }],
  onlineOffer: { enabled: true, manufacturerDisplayed: true, responsiblePersonDisplayed: true,
    productImageDisplayed: true, identifiersDisplayed: true, warningsDisplayed: true, offerUrl: 'https://shop.example/gpsr-shirt-1' },
  seriesProductionProcedure: 'Pull-test each lot and investigate deviations.',
  complaintChannel: 'safety@example.com', postMarketPlan: 'Monthly complaint review and immediate serious-incident escalation.',
  retentionUntil: '2036-09-13', evidenceDocumentIds: [evidenceId],
  ...overrides
});

describe('R10 GPSR technical-file controls', () => {
  test('creates a deterministic, review-ready limited-ruleset result', () => {
    const first = evaluateGpsrTechnicalFile(validInput(), evidence);
    const second = evaluateGpsrTechnicalFile(validInput(), evidence);
    expect(first.result).toMatchObject({
      rulesetVersion: RULESET.version, automatedStatus: 'ready_for_safety_review',
      minimumRetentionUntil: '2036-09-13', rulesetCoverage: 'limited'
    });
    expect(first.inputSha256).toBe(second.inputSha256);
    expect(first.result.resultSha256).toBe(second.result.resultSha256);
  });

  test('blocks an incomplete risk analysis and distance-sale disclosure', () => {
    const input = validInput({
      risks: [], onlineOffer: { enabled: true, manufacturerDisplayed: false }, retentionUntil: '2027-01-01'
    });
    const result = evaluateGpsrTechnicalFile(input, evidence).result;
    expect(result.automatedStatus).toBe('needs_information');
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'RISK_ANALYSIS_REQUIRED', 'DISTANCE_SALE_INFORMATION_INCOMPLETE', 'TECHNICAL_FILE_RETENTION_TOO_SHORT'
    ]));
  });

  test('routes pre-application and harmonised-product cases to specialist review', () => {
    const input = validInput({
      firstPlacedOnMarketDate: '2024-12-12', retentionUntil: '2034-12-12', harmonisationCoverage: 'partial'
    });
    const result = evaluateGpsrTechnicalFile(input, evidence).result;
    expect(result.automatedStatus).toBe('specialist_review_required');
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'GPSR_PRE_APPLICATION_DATE', 'SECTOR_LAW_OVERLAP_REVIEW'
    ]));
  });

  test('requires current controlled evidence for all referenced images and mitigations', () => {
    const result = evaluateGpsrTechnicalFile(validInput(), []).result;
    expect(result.automatedStatus).toBe('needs_information');
    expect(result.findings.map((item) => item.code)).toContain('GPSR_EVIDENCE_REQUIRED');
  });

  test('detects evidence drift after named approval', () => {
    const evaluated = evaluateGpsrTechnicalFile(validInput(), evidence);
    const file = { result: evaluated.result, latestReview: { decision: 'approved_for_internal_release', evidenceSnapshot: evidence } };
    expect(deriveSafetyFileStatus(file, evidence).status).toBe('approved_for_internal_release');
    const changed = [{ ...evidence[0], checksumSha256: 'b'.repeat(64) }];
    expect(deriveSafetyFileStatus(file, changed)).toEqual({ status: 'evidence_review_required', staleEvidenceIds: [evidenceId] });
  });
});
