const { createExportShipmentService } = require('../../src/services/exportShipmentService');
const { evaluateReachDossier } = require('../../src/services/reachSvhcDossierControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const dossierId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidenceRow = { id: evidenceId, evidence_type: 'reach_lab_report', document_name: 'lab.pdf', checksum_sha256: 'a'.repeat(64), file_size_bytes: 42, status: 'locked' };
const evidenceSnapshot = [{ id: evidenceId, type: 'reach_lab_report', name: 'lab.pdf', checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked', validFrom: null, validTo: null }];
const input = {
  dossierReference: 'REACH-1', assessmentDate: '2026-09-13', productReference: 'SKU-1', productName: 'Shirt',
  articleCategory: 'consumer clothing', consumerArticle: true, placedOnEuMarket: true, marketCodes: ['DE'], euActorRole: 'importer',
  articleLevelAssessmentConfirmed: true, candidateListSnapshotDate: '2026-02-04', candidateListEntryCount: 253, reachConsolidatedDate: '2026-06-22',
  components: [{ componentReference: 'button', componentName: 'Button', articleReference: 'BUTTON-1', homogeneousMaterialReference: 'RESIN-1',
    materialName: 'Resin', materialLocation: 'Front', substances: [{ substanceName: 'n-hexane', casNumber: '110-54-3', candidateListStatus: 'included',
      concentrationPercentWw: 0.2, annualTonnage: 0.2, location: 'Resin', evidenceBasis: 'laboratory_test', detectionLimit: 0.01,
      detectionLimitUnit: 'percent_w_w', safeUseInstructions: [{ marketCode: 'DE', languageCode: 'de-DE', text: 'Nicht verbrennen.', operatorApproved: true }],
      article7Exemption: 'none', evidenceDocumentIds: [evidenceId], restrictionAssessments: [{ entryNumber: '72', scopeDecision: 'not_applies',
        scopeRationale: 'Substance is not listed in Appendix 12.', legalLimit: null, limitUnit: '', measuredValue: null, prohibitedWhen: '', testMethod: '',
        exemptionClaimed: false, evidenceDocumentIds: [evidenceId] }] }] }], supplierDeclarationEvidenceIds: [evidenceId]
};

describe('R11 REACH/SVHC persistence controls', () => {
  test('creates the next immutable dossier revision under an advisory lock', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ revision: 2 }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{ id: dossierId, company_id: companyId, shipment_id: shipmentId,
        dossier_reference: values[2], revision: values[3], ruleset_id: values[4], ruleset_version: values[5], ruleset_coverage: values[6],
        source_manifest_sha256: values[7], assessment_date: values[8], candidate_list_snapshot_date: values[9], reach_consolidated_date: values[10],
        input_snapshot: JSON.parse(values[11]), input_sha256: values[12], result_snapshot: JSON.parse(values[13]), result_sha256: values[14],
        evidence_snapshot: JSON.parse(values[15]), automated_status: values[16], created_by: userId, created_at: '2026-09-13T00:00:00Z' }] }))
      .mockResolvedValueOnce({ rows: [] });
    const database = { connect: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValue({ rows: [evidenceRow] }) };
    const service = createExportShipmentService({ database }); service._assertShipment = jest.fn().mockResolvedValue(true);
    const result = await service.createReachSvhcDossierRevision(companyId, shipmentId, userId, input);
    expect(result).toMatchObject({ id: dossierId, revision: 2, automatedStatus: 'ready_for_chemical_review' });
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
  });

  test('rejects approval by a non-chemical role', async () => {
    const database = { query: jest.fn() }; const service = createExportShipmentService({ database });
    const result = await service.reviewReachSvhcDossier(companyId, shipmentId, dossierId, userId,
      { reviewerRole: 'compliance_specialist', decision: 'approved_for_internal_release', notes: 'No.' });
    expect(result.code).toBe('REACH_REVIEW_ROLE_INVALID'); expect(database.query).not.toHaveBeenCalled();
  });

  test('binds named chemical approval to current evidence bytes', async () => {
    const evaluated = evaluateReachDossier(input, evidenceSnapshot);
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: dossierId, revision: 1, latest_revision: 1, automated_status: 'ready_for_chemical_review',
        input_sha256: evaluated.inputSha256, result_snapshot: evaluated.result, result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot }] })
      .mockResolvedValueOnce({ rows: [evidenceRow] }).mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Chemical Reviewer', email: 'review@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: '60000000-0000-4000-8000-000000000001', dossier_id: dossierId, reviewer_id: userId,
        reviewer_name_snapshot: 'Chemical Reviewer', reviewer_email_snapshot: 'review@example.com', reviewer_role: 'chemical_compliance_reviewer',
        decision: 'approved_for_internal_release', notes: 'Approved.', input_sha256: evaluated.inputSha256,
        result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot, created_at: '2026-09-13T01:00:00Z' }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.reviewReachSvhcDossier(companyId, shipmentId, dossierId, userId,
      { reviewerRole: 'chemical_compliance_reviewer', decision: 'approved_for_internal_release', notes: 'Approved.' });
    expect(result).toMatchObject({ reviewerName: 'Chemical Reviewer', decision: 'approved_for_internal_release' });
  });

  test('derives the 45-day consumer deadline without storing personal data', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: dossierId, revision: 1, latest_revision: 1, latest_decision: null }] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Chemical Officer', email: 'chemical@example.com' }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{ id: '70000000-0000-4000-8000-000000000001', shipment_id: shipmentId,
        dossier_id: dossierId, event_type: values[3], event_reference: values[4], occurred_at: values[5], response_due_at: values[6],
        summary: values[7], recorded_by: userId, recorder_name_snapshot: 'Chemical Officer', recorder_email_snapshot: 'chemical@example.com', metadata: {}, created_at: values[5] }] })) };
    const service = createExportShipmentService({ database });
    const result = await service.recordReachObligationEvent(companyId, shipmentId, dossierId, userId, {
      eventType: 'consumer_request_received', eventReference: 'REQ-1', occurredAt: '2026-09-13T00:00:00Z',
      summary: 'Opaque consumer request reference only.', consumerPersonalDataIncluded: false
    });
    expect(result.responseDueAt).toBe('2026-10-28T00:00:00.000Z');
  });

  test('blocks outbound evidence when approved dossier bytes have drifted', async () => {
    const evaluated = evaluateReachDossier(input, evidenceSnapshot);
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: dossierId, revision: 1, latest_revision: 1,
        latest_decision: 'approved_for_internal_release', result_snapshot: evaluated.result,
        evidence_snapshot: evidenceSnapshot, latest_review: {
          decision: 'approved_for_internal_release', evidence_snapshot: evidenceSnapshot
        } }] })
      .mockResolvedValueOnce({ rows: [{ ...evidenceRow, checksum_sha256: 'b'.repeat(64) }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.recordReachObligationEvent(companyId, shipmentId, dossierId, userId, {
      eventType: 'scip_notification', eventReference: 'SCIP-1', occurredAt: '2026-09-13T00:00:00Z',
      summary: 'Submission proof.', externalReference: 'SCIP-SYNTHETIC-1', evidenceDocumentId: evidenceId
    });
    expect(result.code).toBe('REACH_EVIDENCE_STALE');
  });
});
