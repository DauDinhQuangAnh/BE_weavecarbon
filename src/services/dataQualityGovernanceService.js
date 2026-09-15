const pool = require('../config/database');
const { scoreDql, validateFactorProposal, validateFactorReview } = require('./dataQualityGovernanceControls');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class DataQualityGovernanceService {
  constructor(database = pool) { this.database = database; }
  async _companyExists(companyId) { const result = await this.database.query('SELECT id FROM companies WHERE id=$1', [companyId]); return Boolean(result.rows[0]); }
  async _evidence(companyId, ids) {
    if (!ids.length) return [];
    const result = await this.database.query(
      `SELECT id, evidence_type, document_name, checksum_sha256, file_size_bytes, status
       FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [companyId, ids]);
    return result.rows.map((row) => ({ id: row.id, type: row.evidence_type, name: row.document_name,
      checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0), status: row.status }));
  }

  async listDql(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query('SELECT * FROM industrial_dql_assessments WHERE company_id=$1 ORDER BY created_at DESC, id DESC', [companyId]);
    return result.rows.map((row) => this._formatDql(row));
  }

  async createDql(companyId, userId, input) {
    if (!(await this._companyExists(companyId))) return null;
    const scored = scoreDql(input); if (scored.errors.length) return { blocked: true, code: 'DQL_ASSESSMENT_INVALID', message: scored.errors.join(' '), details: scored.errors };
    const value = scored.value; const evidence = await this._evidence(companyId, value.evidenceDocumentIds);
    if (evidence.length !== value.evidenceDocumentIds.length) return { blocked: true, code: 'DQL_EVIDENCE_INVALID', message: 'Every evidence document must belong to the active company.' };
    const scores = value.scores;
    const result = await this.database.query(
      `INSERT INTO industrial_dql_assessments (company_id, subject_type, subject_reference, methodology_version,
         temporal_score, geographic_score, technological_score, completeness_score, reliability_score,
         completeness_percent, overall_score, data_quality_level, rationale, improvement_actions,
         evidence_snapshot, assessment_sha256, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17) RETURNING *`,
      [companyId, value.subjectType, value.subjectReference, value.methodologyVersion, scores.temporal, scores.geographic,
        scores.technological, scores.completeness, scores.reliability, value.completenessPercent, value.overallScore,
        value.dataQualityLevel, value.rationale, JSON.stringify(value.improvementActions), JSON.stringify(evidence), value.assessmentSha256, userId]);
    return this._formatDql(result.rows[0]);
  }

  async listFactorProposals(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT proposal.*, to_jsonb(review) AS latest_review FROM emission_factor_proposals proposal
       LEFT JOIN LATERAL (SELECT candidate.* FROM emission_factor_proposal_reviews candidate
         WHERE candidate.proposal_id=proposal.id AND candidate.company_id=proposal.company_id
         ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1) review ON true
       WHERE proposal.company_id=$1 ORDER BY proposal.created_at DESC, proposal.id DESC`, [companyId]);
    return result.rows.map((row) => this._formatProposal(row));
  }

  async createFactorProposal(companyId, userId, input) {
    if (!(await this._companyExists(companyId))) return null;
    const { value, errors } = validateFactorProposal(input); if (errors.length) return { blocked: true, code: 'FACTOR_PROPOSAL_INVALID', message: errors.join(' '), details: errors };
    const evidence = await this._evidence(companyId, value.evidenceDocumentIds);
    if (evidence.length !== value.evidenceDocumentIds.length) return { blocked: true, code: 'FACTOR_PROPOSAL_EVIDENCE_INVALID', message: 'Every evidence document must belong to the active company.' };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:factor:${value.proposalReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM emission_factor_proposals WHERE company_id=$1 AND proposal_reference=$2', [companyId, value.proposalReference]);
      const inserted = await client.query(
        `INSERT INTO emission_factor_proposals (company_id, proposal_reference, revision, factor_id, label,
           factor_value, unit, source_name, source_url, source_year, geography, boundary, valid_from, valid_to,
           gwp_basis, uncertainty_cv, is_proxy, evidence_snapshot, payload_sha256, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20) RETURNING *`,
        [companyId, value.proposalReference, Number(next.rows[0].revision), value.factorId, value.label, value.factorValue,
          value.unit, value.sourceName, value.sourceUrl, value.sourceYear, value.geography, value.boundary, value.validFrom,
          value.validTo, value.gwpBasis, value.uncertaintyCv, value.isProxy, JSON.stringify(evidence), value.payloadSha256, userId]);
      await client.query('COMMIT'); return this._formatProposal(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async reviewFactorProposal(companyId, proposalId, userId, input) {
    if (!UUID_REGEX.test(String(proposalId || ''))) return null;
    const { value, errors } = validateFactorReview(input); if (errors.length) return { blocked: true, code: 'FACTOR_REVIEW_INVALID', message: errors.join(' '), details: errors };
    const found = await this.database.query('SELECT * FROM emission_factor_proposals WHERE id=$1 AND company_id=$2', [proposalId, companyId]);
    const proposal = found.rows[0]; if (!proposal) return null;
    const currentEvidence = await this._evidence(companyId, (proposal.evidence_snapshot || []).map((item) => item.id));
    const stale = currentEvidence.length !== proposal.evidence_snapshot.length || currentEvidence.some((item) => {
      const snapshot = proposal.evidence_snapshot.find((candidate) => candidate.id === item.id);
      return !snapshot || snapshot.checksumSha256 !== item.checksumSha256 || snapshot.fileSizeBytes !== item.fileSizeBytes;
    });
    if (value.decision === 'approved_for_release_candidate' && (stale || !currentEvidence.length || currentEvidence.some((item) => !['locked', 'third_party_verified'].includes(item.status)))) {
      return { blocked: true, code: 'FACTOR_REVIEW_EVIDENCE_INVALID', message: 'Release-candidate approval requires locked, checksum-identical evidence.' };
    }
    const reviewerResult = await this.database.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
    const reviewer = reviewerResult.rows[0]; if (!reviewer) return { blocked: true, code: 'FACTOR_REVIEWER_NOT_FOUND', message: 'Named reviewer identity is required.' };
    const result = await this.database.query(
      `INSERT INTO emission_factor_proposal_reviews (company_id, proposal_id, reviewer_id, reviewer_name_snapshot,
         reviewer_role, decision, notes, payload_sha256, evidence_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
      [companyId, proposalId, userId, reviewer.full_name || reviewer.email, value.reviewerRole, value.decision,
        value.notes, proposal.payload_sha256, JSON.stringify(currentEvidence)]);
    return this._formatReview(result.rows[0]);
  }

  _formatDql(row) { return { id: row.id, subjectType: row.subject_type, subjectReference: row.subject_reference,
    methodologyVersion: row.methodology_version, scores: { temporal: Number(row.temporal_score), geographic: Number(row.geographic_score),
      technological: Number(row.technological_score), completeness: Number(row.completeness_score), reliability: Number(row.reliability_score) },
    completenessPercent: Number(row.completeness_percent), overallScore: Number(row.overall_score), dataQualityLevel: row.data_quality_level,
    rationale: row.rationale, improvementActions: row.improvement_actions, evidenceSnapshot: row.evidence_snapshot,
    assessmentSha256: row.assessment_sha256, createdAt: row.created_at };
  }
  _formatProposal(row) { return { id: row.id, proposalReference: row.proposal_reference, revision: Number(row.revision), factorId: row.factor_id,
    label: row.label, factorValue: Number(row.factor_value), unit: row.unit, sourceName: row.source_name, sourceUrl: row.source_url,
    sourceYear: row.source_year, geography: row.geography, boundary: row.boundary, validFrom: row.valid_from, validTo: row.valid_to,
    gwpBasis: row.gwp_basis, uncertaintyCv: Number(row.uncertainty_cv), isProxy: row.is_proxy,
    evidenceSnapshot: row.evidence_snapshot, payloadSha256: row.payload_sha256,
    governanceStatus: row.latest_review?.decision || 'submitted_for_review', latestReview: row.latest_review ? this._formatReview(row.latest_review) : null,
    createdAt: row.created_at };
  }
  _formatReview(row) { return { id: row.id, proposalId: row.proposal_id, reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name_snapshot, reviewerRole: row.reviewer_role, decision: row.decision,
    notes: row.notes, payloadSha256: row.payload_sha256, evidenceSnapshot: row.evidence_snapshot, createdAt: row.created_at };
  }
}

module.exports = { DataQualityGovernanceService, dataQualityGovernanceService: new DataQualityGovernanceService() };
