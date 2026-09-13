const { createExportShipmentService } = require('../../src/services/exportShipmentService');
const { evaluateTextileFibreLabel } = require('../../src/services/textileFibreLabelControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const specificationId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidenceRow = {
  id: evidenceId, evidence_type: 'textile_composition_test', document_name: 'composition.pdf',
  checksum_sha256: 'a'.repeat(64), file_size_bytes: 42, status: 'locked', valid_from: null, valid_to: null
};
const input = {
  specificationReference: 'LABEL-1', assessmentDate: '2026-09-13', productReference: 'SKU-1',
  productCategory: 'shirt', specialProductCategory: 'standard', textileFibrePercent: 100, marketCodes: ['DE'],
  components: [{ componentReference: 'shell', componentName: 'Shell', weightPercent: 100,
    mainLining: false, fibres: [{ fibreCode: '5', percentage: 100 }] }],
  animalOriginPresence: 'absent',
  languageLabels: [{ marketCode: 'DE', languageCode: 'de-DE', labelText: '100% Baumwolle',
    animalOriginStatementIncluded: false, operatorApproved: true }],
  economicOperator: { role: 'importer', name: 'Importer GmbH', address: 'Berlin' },
  placement: { method: 'sewn', durable: true, easilyLegible: true, visible: true,
    accessible: true, securelyAttached: true, onlineBeforePurchase: true },
  evidenceDocumentIds: [evidenceId]
};
const evidenceSnapshot = () => [{
  id: evidenceId, type: evidenceRow.evidence_type, name: evidenceRow.document_name,
  checksumSha256: evidenceRow.checksum_sha256, fileSizeBytes: 42, status: 'locked', validFrom: null, validTo: null
}];

describe('R08 textile fibre label persistence controls', () => {
  test('creates an immutable next revision under a transaction lock', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{
        id: specificationId, company_id: companyId, shipment_id: shipmentId,
        specification_reference: values[2], revision: values[3], ruleset_id: values[4],
        ruleset_version: values[5], ruleset_coverage: values[6], source_manifest_sha256: values[7],
        assessment_date: values[8], input_snapshot: JSON.parse(values[9]), input_sha256: values[10],
        result_snapshot: JSON.parse(values[11]), result_sha256: values[12], evidence_snapshot: JSON.parse(values[13]),
        automated_status: values[14], created_by: userId, created_at: '2026-09-13T00:00:00Z'
      }] })).mockResolvedValueOnce({ rows: [] });
    const database = { connect: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValue({ rows: [evidenceRow] }) };
    const service = createExportShipmentService({ database });
    service._assertShipment = jest.fn().mockResolvedValue(true);

    const result = await service.createTextileFibreLabelSpecification(companyId, shipmentId, userId, input);

    expect(result).toMatchObject({ id: specificationId, revision: 2, automatedStatus: 'ready_for_label_review' });
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO textile_fibre_label_specifications');
    expect(client.release).toHaveBeenCalled();
  });

  test('binds named approval to the latest revision and current evidence bytes', async () => {
    const evaluated = evaluateTextileFibreLabel(input, evidenceSnapshot());
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: specificationId, revision: 1, latest_revision: 1, automated_status: 'ready_for_label_review',
        input_sha256: evaluated.inputSha256, result_snapshot: evaluated.result,
        result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot()
      }] })
      .mockResolvedValueOnce({ rows: [evidenceRow] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Textile Reviewer', email: 'review@example.com' }] })
      .mockResolvedValueOnce({ rows: [{
        id: '60000000-0000-4000-8000-000000000001', specification_id: specificationId,
        reviewer_id: userId, reviewer_name_snapshot: 'Textile Reviewer', reviewer_email_snapshot: 'review@example.com',
        reviewer_role: 'textile_label_reviewer', decision: 'approved_for_internal_artwork', notes: 'Approved.',
        input_sha256: evaluated.inputSha256, result_sha256: evaluated.result.resultSha256,
        evidence_snapshot: evidenceSnapshot(), created_at: '2026-09-13T01:00:00Z'
      }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.reviewTextileFibreLabelSpecification(companyId, shipmentId, specificationId, userId, {
      reviewerRole: 'textile_label_reviewer', decision: 'approved_for_internal_artwork', notes: 'Approved.'
    });
    expect(result).toMatchObject({ reviewerName: 'Textile Reviewer', decision: 'approved_for_internal_artwork' });
  });

  test('rejects approval of an older revision', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: specificationId, revision: 1, latest_revision: 2, automated_status: 'ready_for_label_review'
    }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.reviewTextileFibreLabelSpecification(companyId, shipmentId, specificationId, userId, {
      reviewerRole: 'textile_label_reviewer', decision: 'approved_for_internal_artwork', notes: 'Review.'
    });
    expect(result.code).toBe('TEXTILE_LABEL_REVISION_STALE');
  });
});
