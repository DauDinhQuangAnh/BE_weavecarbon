const { createExportShipmentService } = require('../../src/services/exportShipmentService');

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const evaluationId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';

const snapshot = {
  shipment: { id: shipmentId, referenceNumber: 'SHP-1', originCountry: 'VN', destinationCountry: 'NL' },
  profile: { importer: { country: 'NL' }, transportMode: 'sea', customsValueAmount: 500, currency: 'EUR' },
  lines: [{
    id: '60000000-0000-4000-8000-000000000001', sku: 'SKU-1', goodsDescription: 'Shirt',
    hsCode: '62052000', hsCodeConfirmed: true, originCountry: 'VN'
  }],
  euImportLineDetails: [], originProfile: null
};
const input = {
  assessmentDate: '2026-09-13', productCategory: 'apparel', intendedUse: 'wearing',
  consumerGroup: 'adult', importerRole: 'importer', salesChannels: ['retail'],
  consumerProduct: true, placedOnEuMarket: true, textileFibrePercent: 100
};

describe('R20 compliance applicability persistence controls', () => {
  test('persists a checksum-bound immutable evaluation snapshot', async () => {
    const database = { query: jest.fn().mockImplementation(async (sql, values) => ({
      rows: [{
        id: evaluationId, company_id: companyId, shipment_id: shipmentId,
        ruleset_id: values[2], ruleset_version: values[3], ruleset_coverage: values[4],
        source_manifest_sha256: values[5], assessment_date: values[6],
        input_snapshot: JSON.parse(values[7]), input_sha256: values[8],
        result_snapshot: JSON.parse(values[9]), result_sha256: values[10],
        status: values[11], created_by: userId, created_at: '2026-09-13T00:00:00.000Z'
      }]
    })) };
    const service = createExportShipmentService({ database });
    service.getProfile = jest.fn().mockResolvedValue(snapshot);

    const evaluation = await service.evaluateComplianceApplicability(companyId, shipmentId, userId, input);

    expect(evaluation.id).toBe(evaluationId);
    expect(evaluation.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluation.resultSha256).toBe(evaluation.result.resultSha256);
    expect(database.query.mock.calls[0][0]).toMatch(/INSERT INTO compliance_applicability_evaluations/);
    expect(database.query.mock.calls[0][1].slice(0, 2)).toEqual([companyId, shipmentId]);
  });

  test('blocks confirmation without locked evidence', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{
      id: evaluationId, input_sha256: 'a'.repeat(64), result_sha256: 'b'.repeat(64)
    }] }) };
    const service = createExportShipmentService({ database });

    const result = await service.reviewComplianceApplicability(
      companyId, shipmentId, evaluationId, userId,
      { reviewerRole: 'compliance_specialist', decision: 'confirmed_for_internal_planning', notes: 'Checked.' }
    );

    expect(result.code).toBe('COMPLIANCE_REVIEW_EVIDENCE_REQUIRED');
  });

  test('binds a named specialist review to evaluation hashes and tenant-scoped locked evidence', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: evaluationId, input_sha256: 'a'.repeat(64), result_sha256: 'b'.repeat(64)
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: evidenceId, evidence_type: 'compliance_assessment', document_name: 'scope-memo.pdf',
        checksum_sha256: 'c'.repeat(64), file_size_bytes: 42, status: 'locked'
      }] })
      .mockResolvedValueOnce({ rows: [{ id: userId, email: 'specialist@example.com', full_name: 'Named Specialist' }] })
      .mockResolvedValueOnce({ rows: [{
        id: '70000000-0000-4000-8000-000000000001', evaluation_id: evaluationId,
        reviewer_id: userId, reviewer_role: 'compliance_specialist',
        reviewer_name_snapshot: 'Named Specialist', reviewer_email_snapshot: 'specialist@example.com',
        decision: 'confirmed_for_internal_planning', notes: 'Scope memo reviewed.',
        input_sha256: 'a'.repeat(64), result_sha256: 'b'.repeat(64),
        evidence_snapshot: [{ id: evidenceId }], created_at: '2026-09-13T01:00:00.000Z'
      }] }) };
    const service = createExportShipmentService({ database });

    const review = await service.reviewComplianceApplicability(
      companyId, shipmentId, evaluationId, userId, {
        reviewerRole: 'compliance_specialist', decision: 'confirmed_for_internal_planning',
        notes: 'Scope memo reviewed.', evidenceDocumentIds: [evidenceId]
      }
    );

    expect(review).toMatchObject({
      reviewerName: 'Named Specialist', decision: 'confirmed_for_internal_planning',
      inputSha256: 'a'.repeat(64), resultSha256: 'b'.repeat(64)
    });
    expect(database.query.mock.calls[1][1]).toEqual([companyId, shipmentId, [evidenceId]]);
  });
});
