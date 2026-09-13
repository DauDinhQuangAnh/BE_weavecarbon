const { createExportShipmentService } = require('../../src/services/exportShipmentService');
const { evaluateGpsrTechnicalFile } = require('../../src/services/gpsrTechnicalFileControls');

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const fileId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const evidenceRow = { id: evidenceId, evidence_type: 'gpsr_test_report', document_name: 'gpsr.pdf', checksum_sha256: 'a'.repeat(64), file_size_bytes: 42, status: 'locked' };
const evidenceSnapshot = [{ id: evidenceId, type: 'gpsr_test_report', name: 'gpsr.pdf', checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked', validFrom: null, validTo: null }];
const input = {
  fileReference: 'GPSR-1', assessmentDate: '2026-09-13', firstPlacedOnMarketDate: '2026-09-13',
  consumerProduct: true, placedOnEuMarket: true, marketCodes: ['DE'], harmonisationCoverage: 'none',
  product: { brand: 'WC', name: 'Shirt', model: 'M1', batchNumber: 'B1', description: 'Shirt',
    essentialCharacteristics: 'Cotton shirt', productImageEvidenceId: evidenceId, packagingImageEvidenceId: evidenceId },
  intendedUse: 'Adult garment', foreseeableMisuse: 'Near flame', vulnerableGroups: ['children'],
  operators: {
    manufacturer: { name: 'Maker', postalAddress: 'Vietnam', electronicAddress: 'maker@example.com', euEstablished: false },
    importer: { name: 'Importer', postalAddress: 'Germany', electronicAddress: 'importer@example.com', euEstablished: true },
    responsiblePerson: { name: 'RP', postalAddress: 'Germany', electronicAddress: 'rp@example.com', euEstablished: true }
  },
  risks: [{ hazardId: 'H1', hazardCategory: 'mechanical', hazardDescription: 'Loose button', affectedGroups: ['children'],
    foreseeableScenario: 'Swallowing', likelihood: 2, severity: 3, mitigation: 'Pull test', residualLikelihood: 1,
    residualSeverity: 3, verificationEvidenceIds: [evidenceId] }],
  standards: [{ reference: 'TEST-1', version: '1', applicationExtent: 'full' }],
  warnings: [{ marketCode: 'DE', languageCode: 'de-DE', text: 'Warnung', location: 'packaging', operatorApproved: true }],
  onlineOffer: { enabled: true, manufacturerDisplayed: true, responsiblePersonDisplayed: true, productImageDisplayed: true,
    identifiersDisplayed: true, warningsDisplayed: true, offerUrl: 'https://example.com/p' },
  seriesProductionProcedure: 'Lot checks', complaintChannel: 'safety@example.com', postMarketPlan: 'Monthly review',
  retentionUntil: '2036-09-13', evidenceDocumentIds: [evidenceId]
};

describe('R10 GPSR persistence controls', () => {
  test('creates the next immutable technical-file revision under an advisory lock', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{
        id: fileId, company_id: companyId, shipment_id: shipmentId, file_reference: values[2], revision: values[3],
        ruleset_id: values[4], ruleset_version: values[5], ruleset_coverage: values[6], source_manifest_sha256: values[7],
        assessment_date: values[8], first_placed_on_market_date: values[9], retention_until: values[10],
        input_snapshot: JSON.parse(values[11]), input_sha256: values[12], result_snapshot: JSON.parse(values[13]),
        result_sha256: values[14], evidence_snapshot: JSON.parse(values[15]), automated_status: values[16],
        created_by: userId, created_at: '2026-09-13T00:00:00Z'
      }] })).mockResolvedValueOnce({ rows: [] });
    const database = { connect: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValue({ rows: [evidenceRow] }) };
    const service = createExportShipmentService({ database });
    service._assertShipment = jest.fn().mockResolvedValue(true);
    const result = await service.createGpsrTechnicalFileRevision(companyId, shipmentId, userId, input);
    expect(result).toMatchObject({ id: fileId, revision: 2, automatedStatus: 'ready_for_safety_review' });
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO gpsr_technical_file_revisions');
  });

  test('rejects approval by the wrong role before reading the file', async () => {
    const database = { query: jest.fn() };
    const service = createExportShipmentService({ database });
    const result = await service.reviewGpsrTechnicalFile(companyId, shipmentId, fileId, userId, {
      reviewerRole: 'export_operator', decision: 'approved_for_internal_release', notes: 'No.'
    });
    expect(result.code).toBe('GPSR_REVIEW_ROLE_INVALID');
    expect(database.query).not.toHaveBeenCalled();
  });

  test('binds named approval to latest revision and current evidence bytes', async () => {
    const evaluated = evaluateGpsrTechnicalFile(input, evidenceSnapshot);
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: fileId, revision: 1, latest_revision: 1,
        automated_status: 'ready_for_safety_review', input_sha256: evaluated.inputSha256,
        result_snapshot: evaluated.result, result_sha256: evaluated.result.resultSha256, evidence_snapshot: evidenceSnapshot }] })
      .mockResolvedValueOnce({ rows: [evidenceRow] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Safety Reviewer', email: 'review@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: '60000000-0000-4000-8000-000000000001', technical_file_id: fileId,
        reviewer_id: userId, reviewer_name_snapshot: 'Safety Reviewer', reviewer_email_snapshot: 'review@example.com',
        reviewer_role: 'product_safety_reviewer', decision: 'approved_for_internal_release', notes: 'Approved.',
        input_sha256: evaluated.inputSha256, result_sha256: evaluated.result.resultSha256,
        evidence_snapshot: evidenceSnapshot, created_at: '2026-09-13T01:00:00Z' }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.reviewGpsrTechnicalFile(companyId, shipmentId, fileId, userId, {
      reviewerRole: 'product_safety_reviewer', decision: 'approved_for_internal_release', notes: 'Approved.'
    });
    expect(result).toMatchObject({ reviewerName: 'Safety Reviewer', decision: 'approved_for_internal_release' });
  });

  test('does not record a gateway notification without external proof', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: fileId }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.recordGpsrPostMarketEvent(companyId, shipmentId, fileId, userId, {
      eventType: 'safety_business_gateway_notification', eventReference: 'SBG-1',
      occurredAt: '2026-09-13T01:00:00Z', summary: 'Reported serious incident', severity: 'serious'
    });
    expect(result.code).toBe('GPSR_GATEWAY_PROOF_REQUIRED');
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  test('flags serious internal incidents for external gateway follow-up', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: fileId }] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'Safety Officer', email: 'safety@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: '70000000-0000-4000-8000-000000000001', company_id: companyId,
        shipment_id: shipmentId, technical_file_id: fileId, event_type: 'safety_incident', event_reference: 'INC-1',
        occurred_at: '2026-09-13T01:00:00Z', summary: 'Serious injury report', severity: 'serious', recorded_by: userId,
        recorder_name_snapshot: 'Safety Officer', recorder_email_snapshot: 'safety@example.com', metadata: {}, created_at: '2026-09-13T01:01:00Z' }] }) };
    const service = createExportShipmentService({ database });
    const result = await service.recordGpsrPostMarketEvent(companyId, shipmentId, fileId, userId, {
      eventType: 'safety_incident', eventReference: 'INC-1', occurredAt: '2026-09-13T01:00:00Z',
      summary: 'Serious injury report', severity: 'serious'
    });
    expect(result.safetyBusinessGatewayNotificationRequired).toBe(true);
  });
});
