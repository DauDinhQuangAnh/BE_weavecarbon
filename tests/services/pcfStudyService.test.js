const { createExportShipmentService } = require('../../src/services/exportShipmentService');
const { calculateCarbonFootprint } = require('../../src/modules/carbon/core');
const carbonInput = require('../fixtures/carbon/v1/inputs.json').cases[0].input;

const companyId = '10000000-0000-4000-8000-000000000001';
const shipmentId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const snapshotId = '40000000-0000-4000-8000-000000000001';
const evidenceId = '50000000-0000-4000-8000-000000000001';
const studyId = '60000000-0000-4000-8000-000000000001';
const carbonResult = calculateCarbonFootprint(carbonInput);
const evidenceRow = { id: evidenceId, evidence_type: 'pcf_source', document_name: 'source.pdf', checksum_sha256: 'a'.repeat(64), file_size_bytes: 42, status: 'locked' };
const evidenceSnapshot = [{ id: evidenceId, type: 'pcf_source', name: 'source.pdf', checksumSha256: 'a'.repeat(64), fileSizeBytes: 42, status: 'locked', validFrom: null, validTo: null }];
const snapshot = { id: snapshotId, product_id: '70000000-0000-4000-8000-000000000001', version: 1,
  is_legacy: false, finalized_at: '2026-09-13T00:00:00Z', canonical_input_hash: 'b'.repeat(64),
  engine_version: carbonResult.trace.ruleEngineVersion, methodology_version: carbonResult.methodologyVersion,
  factor_registry_version: 'registry-v1', gwp_basis: carbonResult.methodology.gwpBasis,
  factor_snapshot: carbonResult.factorSourceSummary, payload: { carbonInput, carbonResults: carbonResult } };
const input = {
  studyReference: 'PCF-1', studyDate: '2026-09-13', calculationSnapshotId: snapshotId,
  productReference: 'SKU-1', productName: 'Shirt', reportingPeriodStart: '2026-01-01', reportingPeriodEnd: '2026-08-31',
  intendedApplication: 'Internal buyer data review', intendedAudience: 'Buyer sustainability team', comparativeAssertion: false,
  functionalUnit: { quantity: 1, unit: 'piece', description: 'One finished shirt' },
  referenceFlow: { amount: 0.5, unit: 'kg finished product', basis: 'Measured unit mass' },
  boundaryType: 'cradle_to_gate_plus_gate_to_market_extension',
  includedStages: ['materials', 'finished_goods_manufacturing', 'packaging', 'logistics_and_storage'],
  processMap: [{ processReference: 'MAT-1', processName: 'Materials', stage: 'materials', included: true,
    dataSource: 'Supplier records', evidenceDocumentIds: [evidenceId] }],
  excludedProcesses: [{ processName: 'Use phase', rationale: 'Partial CFP boundary', estimatedImpactPercent: 0 }],
  cutoff: { massPercent: 1, energyPercent: 1, environmentalSignificanceApplied: true, rationale: 'Significance screened.' },
  pcr: { status: 'not_identified', name: '', publisher: '', version: '', validFrom: null, validTo: null, rationale: 'Practitioner to confirm.' },
  allocation: { required: false, method: '', rationale: 'No multifunctional process.', hierarchyJustification: '', sensitivityPerformed: false, sensitivitySummary: '' },
  recyclingModel: { method: 'cut-off', rationale: 'End of life excluded.' },
  dataQualityAssessment: 'Five-factor source quality review.', dataImprovementPlan: 'Replace proxy data.',
  uncertaintyAssessment: { method: 'rss_fallback', parameter: 'Parameter uncertainty.', scenario: 'Scenario uncertainty.', model: 'Model uncertainty.', sensitivityScenarios: ['Proxy replacement'] },
  landUseChangeMethod: 'Unavailable and reported separately.', biogenicCarbonTreatment: 'Reported separately, never netted.',
  evidenceDocumentIds: [evidenceId], externalAssuranceRecordId: null, limitations: 'Climate-only partial CFP.'
};

describe('R12 PCF study persistence controls', () => {
  test('creates the next immutable study revision under advisory lock', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
      .mockImplementationOnce(async (_sql, values) => ({ rows: [{ id: studyId, company_id: companyId, shipment_id: shipmentId,
        product_id: snapshot.product_id, calculation_snapshot_id: snapshotId, study_reference: values[4], revision: values[5],
        ruleset_id: values[6], ruleset_version: values[7], ruleset_coverage: values[8], source_manifest_sha256: values[9],
        study_date: values[10], reporting_period_start: values[11], reporting_period_end: values[12],
        calculation_canonical_input_hash: values[13], input_snapshot: JSON.parse(values[14]), input_sha256: values[15],
        result_snapshot: JSON.parse(values[16]), result_sha256: values[17], evidence_snapshot: JSON.parse(values[18]),
        automated_status: values[19], created_by: userId, created_at: '2026-09-13T00:00:00Z' }] }))
      .mockResolvedValueOnce({ rows: [] });
    const database = { connect: jest.fn().mockResolvedValue(client), query: jest.fn()
      .mockResolvedValueOnce({ rows: [snapshot] }).mockResolvedValueOnce({ rows: [evidenceRow] }) };
    const service = createExportShipmentService({ database }); service._assertShipment = jest.fn().mockResolvedValue(true);
    const created = await service.createPcfStudyRevision(companyId, shipmentId, userId, input);
    expect(created).toMatchObject({ id: studyId, revision: 2, automatedStatus: 'practitioner_review_required' });
    expect(client.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
  });

  test('rejects approval by a non-practitioner role', async () => {
    const database = { query: jest.fn() }; const service = createExportShipmentService({ database });
    const reviewed = await service.reviewPcfStudy(companyId, shipmentId, studyId, userId,
      { reviewerRole: 'sustainability_manager', decision: 'approved_for_internal_report', notes: 'No.' });
    expect(reviewed.code).toBe('PCF_REVIEW_ROLE_INVALID'); expect(database.query).not.toHaveBeenCalled();
  });

  test('binds practitioner approval to calculation and evidence bytes', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: studyId, revision: 1, latest_revision: 1,
        latest_calculation_snapshot_id: snapshotId, calculation_snapshot_id: snapshotId,
        automated_status: 'practitioner_review_required', input_sha256: 'c'.repeat(64), result_sha256: 'd'.repeat(64),
        calculation_canonical_input_hash: snapshot.canonical_input_hash,
        result_snapshot: { automatedStatus: 'practitioner_review_required', calculation: { snapshotId } }, evidence_snapshot: evidenceSnapshot }] })
      .mockResolvedValueOnce({ rows: [evidenceRow] })
      .mockResolvedValueOnce({ rows: [{ id: userId, full_name: 'PCF Practitioner', email: 'pcf@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: '80000000-0000-4000-8000-000000000001', study_id: studyId,
        reviewer_id: userId, reviewer_name_snapshot: 'PCF Practitioner', reviewer_email_snapshot: 'pcf@example.com',
        reviewer_role: 'pcf_practitioner_reviewer', decision: 'approved_for_internal_report', notes: 'Reviewed.',
        input_sha256: 'c'.repeat(64), result_sha256: 'd'.repeat(64), calculation_canonical_input_hash: snapshot.canonical_input_hash,
        evidence_snapshot: evidenceSnapshot, created_at: '2026-09-13T01:00:00Z' }] }) };
    const service = createExportShipmentService({ database });
    const reviewed = await service.reviewPcfStudy(companyId, shipmentId, studyId, userId,
      { reviewerRole: 'pcf_practitioner_reviewer', decision: 'approved_for_internal_report', notes: 'Reviewed.' });
    expect(reviewed).toMatchObject({ reviewerName: 'PCF Practitioner', decision: 'approved_for_internal_report' });
  });

  test('blocks approval after a newer calculation snapshot exists', async () => {
    const database = { query: jest.fn().mockResolvedValueOnce({ rows: [{ id: studyId, revision: 1, latest_revision: 1,
      latest_calculation_snapshot_id: '90000000-0000-4000-8000-000000000001', calculation_snapshot_id: snapshotId,
      automated_status: 'practitioner_review_required' }] }) };
    const service = createExportShipmentService({ database });
    const reviewed = await service.reviewPcfStudy(companyId, shipmentId, studyId, userId,
      { reviewerRole: 'pcf_practitioner_reviewer', decision: 'approved_for_internal_report', notes: 'Reviewed.' });
    expect(reviewed.code).toBe('PCF_STUDY_NOT_CURRENT');
  });
});
