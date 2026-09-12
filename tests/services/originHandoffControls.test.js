const {
  HANDOFF_SCHEMA,
  buildOriginHandoffDataset,
  expectedRuleCodes,
  normalizeOriginProfile,
  validateOriginHandoff
} = require('../../src/services/originHandoffControls');

const evidenceId = '33333333-3333-4333-8333-333333333333';
const lineId = '22222222-2222-4222-8222-222222222222';

const makeSnapshot = () => ({
  shipment: {
    id: '11111111-1111-4111-8111-111111111111', referenceNumber: 'VN-EU-R07-001',
    originCountry: 'VN', destinationCountry: 'DE'
  },
  profile: { preferentialOriginClaim: true, invoiceNumber: 'INV-R07-001' },
  lines: [{
    id: lineId, lineNumber: 1, sku: 'TEE-001', goodsDescription: 'Men knitted cotton T-shirts',
    hsCode: '610910', hsCodeConfirmed: true
  }],
  carrierDocuments: [{
    id: evidenceId, type: 'origin_support', status: 'locked', checksumSha256: 'a'.repeat(64)
  }],
  originProfile: normalizeOriginProfile({
    claimType: 'certificate_application', invoiceTotalEur: 8000,
    territorialityConfirmed: true, nonAlterationConfirmed: true,
    insufficientProcessingExcluded: true,
    lineAssessments: [{
      exportLineId: lineId,
      ruleCode: 'CH61_CUT_SEWN_KNITTING_AND_MAKING_UP',
      ruleSourcePage: 'Annex II, OJ L186/1360, Chapter 61',
      productionProcesses: ['knitting', 'making_up_including_cutting'],
      exWorksPrice: 10000, nonOriginatingMaterialValue: 2500,
      materials: [{
        id: 'MAT-1', reference: 'YARN-1', description: 'Cotton yarn', hsCode: '5205',
        supplierName: 'Supplier A', originCountry: 'IN', originStatus: 'non_originating',
        value: 2500, weightKg: 100, evidenceDocumentId: evidenceId
      }]
    }]
  })
});

describe('EVFTA R07 origin-support handoff controls', () => {
  test('is not applicable unless preferential treatment is claimed', () => {
    const snapshot = makeSnapshot();
    snapshot.profile.preferentialOriginClaim = false;
    expect(validateOriginHandoff(snapshot)).toMatchObject({
      status: 'not_applicable', applicability: 'PREFERENCE_NOT_CLAIMED'
    });
  });

  test('accepts a complete Chapter 61 handoff only for specialist review', () => {
    const result = validateOriginHandoff(makeSnapshot());
    expect(result.status).toBe('ready_for_specialist_review');
    expect(result.blockingCodes).toEqual([]);
  });

  test('blocks factory-address inference and unsupported production steps', () => {
    const snapshot = makeSnapshot();
    snapshot.originProfile.lineAssessments[0].productionProcesses = ['cutting', 'sewing'];
    expect(validateOriginHandoff(snapshot).blockingCodes).toContain('line_1_rule_execution');
  });

  test('requires locked SHA-bound evidence for every material row', () => {
    const snapshot = makeSnapshot();
    snapshot.carrierDocuments[0].status = 'uploaded';
    expect(validateOriginHandoff(snapshot).blockingCodes).toContain('line_1_material_1_evidence');
  });

  test('requires an exporter authorisation route above EUR 6,000 for declaration drafts', () => {
    const snapshot = makeSnapshot();
    snapshot.originProfile.claimType = 'origin_declaration_draft';
    expect(validateOriginHandoff(snapshot).blockingCodes).toContain('exporter_authorization');
  });

  test('routes Chapter 62 exceptions to explicit specialist rule review', () => {
    expect(expectedRuleCodes('6204.42')).toEqual(['SPECIALIST_RULE_REVIEW']);
    expect(expectedRuleCodes('6403.99')).toEqual(['CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY']);
  });

  test('blocks a non-EU destination even when it is a valid ISO country code', () => {
    const snapshot = makeSnapshot();
    snapshot.shipment.destinationCountry = 'US';
    expect(validateOriginHandoff(snapshot).blockingCodes).toContain('evfta_lane');
  });

  test('blocks an unclassified non-originating heading-6406 material in the footwear route', () => {
    const snapshot = makeSnapshot();
    snapshot.lines[0].hsCode = '640399';
    snapshot.originProfile.lineAssessments[0].ruleCode = 'CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY';
    snapshot.originProfile.lineAssessments[0].materials[0].hsCode = '640610';
    expect(validateOriginHandoff(snapshot).blockingCodes).toContain('line_1_rule_execution');
  });

  test('builds a non-authority handoff and never fabricates EUR.1 or preference status', () => {
    const dataset = buildOriginHandoffDataset(makeSnapshot(), {
      generatedAt: '2026-09-12T00:00:00.000Z', documentVersion: 1,
      sourceSnapshotSha256: 'b'.repeat(64), reconciliation: { status: 'ready_for_specialist_review' }
    });
    expect(dataset).toMatchObject({
      schema: { id: HANDOFF_SCHEMA.id },
      datasetNature: 'EVFTA_ORIGIN_SUPPORT_HANDOFF_NOT_PROOF_OF_ORIGIN',
      notProofOfOrigin: true,
      proofOfOriginStatus: 'NOT_ISSUED',
      preferentialTreatmentStatus: 'NOT_GRANTED',
      specialistReviewRequired: true
    });
    expect(JSON.stringify(dataset)).not.toMatch(/"eur1Number"|"authorityAccepted"|"originating":true/i);
  });
});
