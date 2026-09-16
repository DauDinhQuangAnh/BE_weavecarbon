const pool = require('../config/database');
const { PACKS, DISCLAIMER, validate, calculate, sha } = require('./industryPackControls');

class IndustryPackService {
  constructor(database = pool) { this.database = database; }
  listPacks() { return Object.values(PACKS).map((pack) => ({ ...pack, disclaimer: DISCLAIMER })); }
  async listPilots(companyId) {
    const company = await this.database.query('SELECT id FROM companies WHERE id=$1', [companyId]); if (!company.rows[0]) return null;
    const result = await this.database.query('SELECT * FROM industry_pack_pilot_snapshots WHERE company_id=$1 ORDER BY created_at DESC, id DESC', [companyId]);
    return result.rows.map(this.formatPilot);
  }
  async createPilot(companyId, userId, input) {
    const { value, pack, errors } = validate(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRY_PACK_PILOT_INVALID', message: errors.join(' '), details: errors };
    const factorIds = [...new Set(value.activityLines.map((line) => line.factorProposalId))];
    const evidenceIds = [...new Set([...value.productionEvidenceDocumentIds, ...value.activityLines.flatMap((line) => line.evidenceDocumentIds)])];
    const [process, factors, evidence] = await Promise.all([
      this.database.query('SELECT id, process_type FROM industrial_process_revisions WHERE id=$1 AND facility_revision_id=$2 AND company_id=$3', [value.processRevisionId, value.facilityRevisionId, companyId]),
      this.database.query(`SELECT f.*, (SELECT r.decision FROM emission_factor_proposal_reviews r WHERE r.proposal_id=f.id AND r.company_id=f.company_id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_review_decision FROM emission_factor_proposals f WHERE f.company_id=$1 AND f.id=ANY($2::uuid[])`, [companyId, factorIds]),
      this.database.query('SELECT id, status, checksum_sha256, file_size_bytes, document_name FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id', [companyId, evidenceIds])
    ]);
    if (!process.rows[0] || !pack.pilotProcesses.includes(process.rows[0].process_type) || factors.rows.length !== factorIds.length || evidence.rows.length !== evidenceIds.length) return { blocked: true, code: 'INDUSTRY_PACK_REFERENCE_INVALID', message: 'Pilot process, factor and evidence references must match the pack and active company.' };
    const factorEvidenceIds = [...new Set(factors.rows.flatMap((factor) => Array.isArray(factor.evidence_snapshot) ? factor.evidence_snapshot.map((item) => item.id) : []))];
    const factorEvidence = factorEvidenceIds.length ? await this.database.query('SELECT id, status, checksum_sha256, file_size_bytes FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[])', [companyId, factorEvidenceIds]) : { rows: [] };
    const currentFactorEvidence = new Map(factorEvidence.rows.map((row) => [row.id, row]));
    const staleFactorEvidence = factors.rows.some((factor) => !Array.isArray(factor.evidence_snapshot) || !factor.evidence_snapshot.length || factor.evidence_snapshot.some((snapshot) => {
      const current = currentFactorEvidence.get(snapshot.id);
      return !current || !['locked', 'third_party_verified'].includes(current.status) || current.checksum_sha256 !== snapshot.checksumSha256 || Number(current.file_size_bytes || 0) !== Number(snapshot.fileSizeBytes || 0);
    }));
    if (staleFactorEvidence) return { blocked: true, code: 'INDUSTRY_PACK_FACTOR_EVIDENCE_STALE', message: 'Factor proposal evidence is missing, stale or no longer controlled.' };
    const evidenceSnapshot = evidence.rows.map((row) => ({ id: row.id, status: row.status, checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0), name: row.document_name }));
    if (evidenceSnapshot.some((item) => !['locked', 'third_party_verified'].includes(item.status) || !/^[a-f0-9]{64}$/i.test(item.checksumSha256) || item.fileSizeBytes <= 0)) return { blocked: true, code: 'INDUSTRY_PACK_EVIDENCE_UNCONTROLLED', message: 'All activity and production evidence must be locked, non-empty and checksum identified.' };
    const calculated = calculate(value, factors.rows);
    const result = { schemaId: 'weavecarbon.industry-pack-pilot', schemaVersion: '1.0.0', pack: { id: pack.id, version: pack.version, approvalStatus: pack.approvalStatus, sources: pack.sources },
      status: calculated.status, findings: calculated.findings, lines: calculated.lines, totals: calculated.totals, targetMappings: pack.targetMappings, disclaimer: DISCLAIMER };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:industry-pack:${value.studyReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industry_pack_pilot_snapshots WHERE company_id=$1 AND study_reference=$2', [companyId, value.studyReference]);
      const inserted = await client.query(`INSERT INTO industry_pack_pilot_snapshots (company_id,facility_revision_id,process_revision_id,study_reference,revision,pack_id,pack_version,pack_approval_status,period_start,period_end,input_snapshot,input_sha256,result_snapshot,result_sha256,evidence_snapshot,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15::jsonb,$16,$17) RETURNING *`,
        [companyId,value.facilityRevisionId,value.processRevisionId,value.studyReference,Number(next.rows[0].revision),pack.id,pack.version,pack.approvalStatus,value.periodStart,value.periodEnd,JSON.stringify(value),sha(value),JSON.stringify(result),sha(result),JSON.stringify(evidenceSnapshot),calculated.status,userId]);
      await client.query('COMMIT'); return this.formatPilot(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
  formatPilot(row) { return { id: row.id, facilityRevisionId: row.facility_revision_id, processRevisionId: row.process_revision_id, studyReference: row.study_reference,
    revision: Number(row.revision), packId: row.pack_id, packVersion: row.pack_version, packApprovalStatus: row.pack_approval_status,
    periodStart: row.period_start, periodEnd: row.period_end, input: row.input_snapshot, inputSha256: row.input_sha256,
    result: row.result_snapshot, resultSha256: row.result_sha256, evidenceSnapshot: row.evidence_snapshot, status: row.status, createdAt: row.created_at }; }
}
module.exports = { IndustryPackService, industryPackService: new IndustryPackService() };
