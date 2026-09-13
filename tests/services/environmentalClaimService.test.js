const { createExportShipmentService } = require('../../src/services/exportShipmentService');
const { evaluateEnvironmentalClaim } = require('../../src/services/environmentalClaimControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const dossierId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);
const evidenceRow = {
  id: evidenceId, evidence_type: 'environmental_claim_substantiation', document_name: 'method.pdf',
  checksum_sha256: 'b'.repeat(64), file_size_bytes: 42, status: 'locked',
  valid_from: '2026-01-01', valid_to: '2027-12-31'
};
const input = {
  claimReference: 'CLAIM-1', exactClaimText: 'This SKU uses 20% less cradle-to-gate CO2e than baseline X.',
  publicCommunication: true, channel: 'website', marketCodes: ['DE'], languageCode: 'de-DE',
  communicationStart: '2026-09-27', communicationEnd: '2027-06-30', subjectType: 'sku',
  subjectReference: 'SKU-1', scopeStatement: 'SKU and cradle-to-gate only', claimKind: 'specific_environmental',
  specificationText: 'Compared with the 2025 baseline using method 1.0.',
  claimScopeMode: 'specific_aspect', actualCoverage: 'aspect_only',
  methodology: { standard: 'method', version: '1.0', calculationSha256: SHA, datasetReferences: ['dataset-v1'], factorReferences: ['factor-v1'] },
  limitations: ['supplier coverage'], exclusions: ['use phase'], uncertaintyStatement: '±15%', qualifiers: ['cradle-to-gate'],
  updateTriggers: ['method changes'], withdrawalTriggers: ['evidence expires'], evidenceDocumentIds: [evidenceId]
};

function evidenceSnapshot() {
  return [{
    id: evidenceId, type: evidenceRow.evidence_type, name: evidenceRow.document_name,
    checksumSha256: evidenceRow.checksum_sha256, fileSizeBytes: 42, status: 'locked',
    validFrom: '2026-01-01', validTo: '2027-12-31'
  }];
}

describe('R18 environmental claim persistence controls', () => {
  test('creates an immutable next revision under an advisory transaction lock', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{
        id: dossierId, company_id: companyId, shipment_id: shipmentId,
        claim_reference: values[2], revision: values[3], ruleset_id: values[4], ruleset_version: values[5],
        ruleset_coverage: values[6], source_manifest_sha256: values[7], communication_start: values[8],
        communication_end: values[9], input_snapshot: JSON.parse(values[10]), input_sha256: values[11],
        result_snapshot: JSON.parse(values[12]), result_sha256: values[13], evidence_snapshot: JSON.parse(values[14]),
        automated_status: values[15], created_by: userId, created_at: '2026-09-13T00:00:00Z'
      }] }))
      .mockResolvedValueOnce({ rows: [] });
    const database = { connect: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValue({ rows: [evidenceRow] }) };
    const service = createExportShipmentService({ database });
    service._assertShipment = jest.fn().mockResolvedValue(true);

    const result = await service.createEnvironmentalClaimDossier(companyId, shipmentId, userId, input);

    expect(result).toMatchObject({ id: dossierId, revision: 2, automatedStatus: 'ready_for_legal_review' });
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO environmental_claim_dossiers');
    expect(client.release).toHaveBeenCalled();
  });

  test('binds named legal approval to the latest revision and current evidence bytes', async () => {
    const evaluated = evaluateEnvironmentalClaim(input, evidenceSnapshot());
    const dossier = {
      id: dossierId, company_id: companyId, shipment_id: shipmentId, claim_reference: 'CLAIM-1', revision: 1,
      latest_revision: 1, automated_status: 'ready_for_legal_review', latest_review: null,
      input_snapshot: evaluated.input, input_sha256: evaluated.inputSha256,
      result_snapshot: evaluated.result, result_sha256: evaluated.result.resultSha256,
      evidence_snapshot: evidenceSnapshot()
    };
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [dossier] })
      .mockResolvedValueOnce({ rows: [evidenceRow] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Legal Reviewer', email: 'legal@example.com' }] })
      .mockResolvedValueOnce({ rows: [{
        id: '60000000-0000-4000-8000-000000000001', dossier_id: dossierId, reviewer_id: userId,
        reviewer_name_snapshot: 'Legal Reviewer', reviewer_email_snapshot: 'legal@example.com',
        reviewer_role: 'legal_claim_reviewer', decision: 'approved_for_publication', notes: 'Exact scope approved.',
        input_sha256: evaluated.inputSha256, result_sha256: evaluated.result.resultSha256,
        evidence_snapshot: evidenceSnapshot(), created_at: '2026-09-13T01:00:00Z'
      }] }) };
    const service = createExportShipmentService({ database });

    const result = await service.reviewEnvironmentalClaimDossier(companyId, shipmentId, dossierId, userId, {
      reviewerRole: 'legal_claim_reviewer', decision: 'approved_for_publication', notes: 'Exact scope approved.'
    });

    expect(result).toMatchObject({ reviewerName: 'Legal Reviewer', decision: 'approved_for_publication' });
    expect(database.query.mock.calls[1][1]).toEqual([companyId, shipmentId, [evidenceId]]);
  });

  test('rejects approval of an older revision', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: dossierId, revision: 1, latest_revision: 2, automated_status: 'ready_for_legal_review'
    }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.reviewEnvironmentalClaimDossier(companyId, shipmentId, dossierId, userId, {
      reviewerRole: 'legal_claim_reviewer', decision: 'approved_for_publication', notes: 'Review.'
    });
    expect(result.code).toBe('ENVIRONMENTAL_CLAIM_REVISION_STALE');
  });

  test('derives an older revision as superseded even if it was approved', () => {
    const evaluated = evaluateEnvironmentalClaim(input, evidenceSnapshot());
    const service = createExportShipmentService({ database: {} });
    const formatted = service._formatEnvironmentalClaimDossier({
      id: dossierId, shipment_id: shipmentId, claim_reference: 'CLAIM-1', revision: 1, latest_revision: 2,
      ruleset_id: evaluated.result.rulesetId, ruleset_version: evaluated.result.rulesetVersion,
      ruleset_coverage: evaluated.result.rulesetCoverage, source_manifest_sha256: evaluated.result.sourceManifestSha256,
      communication_start: '2026-09-27', communication_end: '2027-06-30', input_snapshot: evaluated.input,
      input_sha256: evaluated.inputSha256, result_snapshot: evaluated.result,
      result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot(),
      automated_status: 'ready_for_legal_review', created_at: '2026-09-13T00:00:00Z',
      latest_review: {
        id: '60000000-0000-4000-8000-000000000001', dossier_id: dossierId, reviewer_id: userId,
        reviewer_name_snapshot: 'Legal Reviewer', reviewer_role: 'legal_claim_reviewer',
        decision: 'approved_for_publication', notes: 'Approved.', input_sha256: evaluated.inputSha256,
        result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot(), created_at: '2026-09-13T01:00:00Z'
      }
    }, evidenceSnapshot());
    expect(formatted.publicationStatus).toBe('superseded');
  });
});
