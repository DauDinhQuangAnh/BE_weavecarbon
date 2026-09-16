const steel = require('../fixtures/industryPacks/steel.json');
const { IndustryPackService } = require('../../src/services/industryPackService');

const evidenceId = steel.productionEvidenceDocumentIds[0];
const checksum = 'b'.repeat(64);
function database({ stale = false, processType = 'eaf' } = {}) {
  const client = { query: jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('MAX(revision)')) return { rows: [{ revision: 1 }] };
    if (sql.includes('INSERT INTO industry_pack_pilot_snapshots')) return { rows: [{ id: '70000000-0000-4000-8000-000000000001', study_reference: steel.studyReference, revision: 1, pack_id: 'steel', pack_version: 'G2-STEEL-PILOT-1.0.0', pack_approval_status: 'expert_review_required', result_snapshot: { totals: { grossKgCo2e: 1550 } }, status: 'specialist_review_required' }] };
    throw new Error(`Unexpected transaction SQL: ${sql}`);
  }), release: jest.fn() };
  const query = jest.fn(async (sql) => {
    if (sql.includes('FROM industrial_process_revisions')) return { rows: [{ id: steel.processRevisionId, process_type: processType }] };
    if (sql.includes('FROM emission_factor_proposals')) return { rows: steel.activityLines.map((line, index) => ({ id: line.factorProposalId, factor_id: `F-${index}`, factor_value: [2, 3, 4][index], unit: `kgCO2e/${line.activityUnit}`, payload_sha256: 'a'.repeat(64), latest_review_decision: 'approved_for_release_candidate', boundary: 'Non-overlapping', is_proxy: false, evidence_snapshot: [{ id: evidenceId, checksumSha256: checksum, fileSizeBytes: 10 }] })) };
    if (sql.includes('FROM evidence_documents')) return { rows: [{ id: evidenceId, status: 'locked', checksum_sha256: stale ? 'c'.repeat(64) : checksum, file_size_bytes: 10, document_name: 'Pilot evidence' }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query, connect: jest.fn(async () => client), client };
}
describe('G2-05 industry pack service', () => {
  test('writes an immutable pilot with governed factors and controlled evidence', async () => {
    const db = database(); const pilot = await new IndustryPackService(db).createPilot('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', steel);
    expect(pilot.status).toBe('specialist_review_required'); expect(pilot.result.totals.grossKgCo2e).toBe(1550); expect(db.client.query).toHaveBeenCalledWith('COMMIT');
  });
  test('rejects stale factor evidence before writing', async () => {
    const db = database({ stale: true }); const result = await new IndustryPackService(db).createPilot('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', steel);
    expect(result.code).toBe('INDUSTRY_PACK_FACTOR_EVIDENCE_STALE'); expect(db.connect).not.toHaveBeenCalled();
  });
  test('does not apply EAF method to an unsupported process', async () => {
    const db = database({ processType: 'rolling' }); const result = await new IndustryPackService(db).createPilot('90000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', steel);
    expect(result.code).toBe('INDUSTRY_PACK_REFERENCE_INVALID');
  });
});
