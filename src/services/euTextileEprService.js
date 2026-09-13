const pool = require('../config/database');
const { RULESET, normalizeEprInput, evaluateEprAssessment, deriveEprStatus } = require('./euTextileEprControls');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_EVIDENCE_TYPES = Object.freeze({
  authority_registration_confirmed: ['epr_authority_response'], pro_membership_confirmed: ['epr_pro_confirmation'],
  report_submission_confirmed: ['epr_submission_receipt'], fee_payment_confirmed: ['epr_payment_receipt'],
  authority_rejected: ['epr_authority_response'], registration_withdrawn: ['epr_authority_response']
});
function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function dateOnly(value) { if (!value) return null; return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }

class EuTextileEprService {
  constructor(database = pool) { this.database = database; }

  async _companyExists(companyId) {
    const result = await this.database.query('SELECT id, name FROM companies WHERE id=$1', [companyId]);
    return result.rows[0] || null;
  }

  async _loadEvidence(companyId, evidenceIds) {
    if (!evidenceIds.length) return [];
    const result = await this.database.query(
      `SELECT id, evidence_type, document_name, source_vendor, checksum_sha256, file_size_bytes, status
       FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [companyId, evidenceIds]
    );
    return result.rows.map((row) => ({ id: row.id, type: row.evidence_type, name: row.document_name,
      sourceVendor: row.source_vendor, checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0), status: row.status }));
  }

  async _loadShipmentSnapshot(companyId, normalized) {
    if (!normalized.memberState || !normalized.reportingPeriodStart || !normalized.reportingPeriodEnd) return [];
    const result = await this.database.query(
      `SELECT line.id AS line_id, line.shipment_id, profile.invoice_date, shipment.destination_country,
              line.sku, line.goods_description, line.hs_code, line.hs_code_confirmed,
              line.quantity, line.unit, line.net_weight_kg
       FROM shipment_export_lines line
       JOIN shipments shipment ON shipment.id=line.shipment_id AND shipment.company_id=line.company_id
       JOIN shipment_export_profiles profile ON profile.shipment_id=line.shipment_id AND profile.company_id=line.company_id
       WHERE line.company_id=$1 AND upper(shipment.destination_country)=$2
         AND profile.invoice_date BETWEEN $3 AND $4
       ORDER BY profile.invoice_date, line.shipment_id, line.line_number`,
      [companyId, normalized.memberState, normalized.reportingPeriodStart, normalized.reportingPeriodEnd]
    );
    return result.rows.map((row) => ({ lineId: row.line_id, shipmentId: row.shipment_id, invoiceDate: dateOnly(row.invoice_date),
      destinationCountry: text(row.destination_country).toUpperCase(), sku: row.sku, productDescription: row.goods_description,
      cnCode: text(row.hs_code).replace(/[^0-9]/g, ''), hsCodeConfirmed: row.hs_code_confirmed === true,
      quantity: Number(row.quantity), unit: text(row.unit).toUpperCase(), weightKg: row.net_weight_kg === null ? null : Number(row.net_weight_kg) }));
  }

  async createRevision(companyId, userId, input = {}) {
    if (!(await this._companyExists(companyId))) return null;
    const normalized = normalizeEprInput(input);
    if (!normalized.assessmentReference || !normalized.assessmentDate) return { blocked: true, code: 'EPR_ASSESSMENT_IDENTITY_REQUIRED',
      message: 'assessmentReference and assessmentDate are required.' };
    const evidenceIds = new Set(normalized.evidenceDocumentIds);
    normalized.authorizedRepresentative.mandateEvidenceIds.forEach((id) => evidenceIds.add(id));
    normalized.producerResponsibilityOrganisation.mandateEvidenceIds.forEach((id) => evidenceIds.add(id));
    normalized.memberStateRule.reviewEvidenceIds.forEach((id) => evidenceIds.add(id));
    const ids = [...evidenceIds].filter(Boolean).sort();
    if (ids.length > 500 || ids.some((id) => !UUID_REGEX.test(id))) return { blocked: true, code: 'EPR_EVIDENCE_INVALID',
      message: 'EPR evidence must contain at most 500 valid UUIDs.' };
    const [shipmentSnapshot, evidenceSnapshot] = await Promise.all([
      this._loadShipmentSnapshot(companyId, normalized), this._loadEvidence(companyId, ids)
    ]);
    if (evidenceSnapshot.length !== ids.length) return { blocked: true, code: 'EPR_EVIDENCE_INVALID',
      message: 'Every EPR evidence id must belong to the active company.' };
    const evaluation = evaluateEprAssessment(input, shipmentSnapshot, evidenceSnapshot);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:epr:${evaluation.input.assessmentReference}`]);
      const revisionResult = await client.query(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision FROM eu_textile_epr_assessment_revisions
         WHERE company_id=$1 AND assessment_reference=$2`, [companyId, evaluation.input.assessmentReference]
      );
      const inserted = await client.query(
        `INSERT INTO eu_textile_epr_assessment_revisions (
           company_id, assessment_reference, revision, member_state, ruleset_id, ruleset_version, ruleset_coverage,
           source_manifest_sha256, assessment_date, reporting_period_start, reporting_period_end,
           input_snapshot, input_sha256, shipment_snapshot, shipment_snapshot_sha256,
           result_snapshot, result_sha256, evidence_snapshot, automated_status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16::jsonb,$17,$18::jsonb,$19,$20)
         RETURNING *`, [companyId, evaluation.input.assessmentReference, Number(revisionResult.rows[0].revision),
          evaluation.input.memberState, RULESET.id, RULESET.version, RULESET.coverageStatus, evaluation.result.sourceManifestSha256,
          evaluation.input.assessmentDate, evaluation.input.reportingPeriodStart, evaluation.input.reportingPeriodEnd,
          JSON.stringify(evaluation.input), evaluation.inputSha256, JSON.stringify(evaluation.shipmentSnapshot), evaluation.shipmentSnapshotSha256,
          JSON.stringify(evaluation.result), evaluation.result.resultSha256, JSON.stringify(evidenceSnapshot), evaluation.result.automatedStatus, userId]
      );
      await client.query('COMMIT');
      return this._formatAssessment(inserted.rows[0], evidenceSnapshot, []);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async list(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT assessment.*, to_jsonb(latest_review) AS latest_review,
              COALESCE(events.items, '[]'::jsonb) AS external_events,
              MAX(assessment.revision) OVER (PARTITION BY assessment.assessment_reference) AS latest_revision
       FROM eu_textile_epr_assessment_revisions assessment
       LEFT JOIN LATERAL (SELECT review.* FROM eu_textile_epr_reviews review
         WHERE review.assessment_id=assessment.id AND review.company_id=assessment.company_id
         ORDER BY review.created_at DESC, review.id DESC LIMIT 1) latest_review ON true
       LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(event) ORDER BY event.occurred_at, event.id) AS items
         FROM eu_textile_epr_external_events event WHERE event.assessment_id=assessment.id AND event.company_id=assessment.company_id) events ON true
       WHERE assessment.company_id=$1 ORDER BY assessment.created_at DESC, assessment.id DESC`, [companyId]
    );
    const evidenceIds = [...new Set(result.rows.flatMap((row) => [
      ...array(row.evidence_snapshot).map((item) => item.id),
      ...array(row.external_events).flatMap((event) => array(event.evidence_snapshot).map((item) => item.id))
    ]))];
    const currentEvidence = await this._loadEvidence(companyId, evidenceIds);
    return result.rows.map((row) => this._formatAssessment(row, currentEvidence, array(row.external_events)));
  }

  async review(companyId, assessmentId, userId, input = {}) {
    if (!UUID_REGEX.test(text(assessmentId))) return null;
    const role = text(input.reviewerRole || input.reviewer_role); const decision = text(input.decision).toLowerCase(); const notes = text(input.notes);
    if (role !== 'eu_epr_specialist') return { blocked: true, code: 'EPR_REVIEW_ROLE_INVALID', message: 'R17 assessments require the eu_epr_specialist role.' };
    if (!['approved_for_internal_planning', 'needs_information', 'rejected'].includes(decision) || !notes) return { blocked: true,
      code: 'EPR_REVIEW_INVALID', message: 'A supported decision and review notes are required.' };
    const found = await this.database.query(
      `SELECT assessment.*, (SELECT MAX(candidate.revision) FROM eu_textile_epr_assessment_revisions candidate
         WHERE candidate.company_id=assessment.company_id AND candidate.assessment_reference=assessment.assessment_reference) AS latest_revision
       FROM eu_textile_epr_assessment_revisions assessment WHERE assessment.id=$1 AND assessment.company_id=$2`, [assessmentId, companyId]
    );
    const assessment = found.rows[0]; if (!assessment) return null;
    if (decision === 'approved_for_internal_planning' && (assessment.automated_status !== 'specialist_review_required'
      || Number(assessment.latest_revision) !== Number(assessment.revision))) return { blocked: true, code: 'EPR_ASSESSMENT_NOT_CURRENT',
      message: 'Only the latest passing assessment revision may be approved.' };
    const evidenceSnapshot = await this._loadEvidence(companyId, array(assessment.evidence_snapshot).map((item) => item.id));
    if (decision === 'approved_for_internal_planning') {
      const status = deriveEprStatus({ result_snapshot: assessment.result_snapshot,
        latest_review: { decision, evidence_snapshot: assessment.evidence_snapshot } }, evidenceSnapshot, []);
      if (status.status !== 'approved_for_internal_planning' || !evidenceSnapshot.length) return { blocked: true,
        code: 'EPR_EVIDENCE_STALE', message: 'Approval requires current checksum-identical controlled evidence.' };
    }
    const reviewerResult = await this.database.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
    const reviewer = reviewerResult.rows[0]; if (!reviewer || !text(reviewer.full_name || reviewer.email)) return { blocked: true,
      code: 'EPR_REVIEWER_NOT_FOUND', message: 'Named EPR reviewer identity is required.' };
    const inserted = await this.database.query(
      `INSERT INTO eu_textile_epr_reviews (company_id, assessment_id, reviewer_id, reviewer_name_snapshot,
         reviewer_email_snapshot, reviewer_role, decision, notes, input_sha256, shipment_snapshot_sha256,
         result_sha256, evidence_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *`,
      [companyId, assessmentId, userId, reviewer.full_name || reviewer.email, reviewer.email || null, role, decision, notes,
        assessment.input_sha256, assessment.shipment_snapshot_sha256, assessment.result_sha256, JSON.stringify(evidenceSnapshot)]
    );
    return this._formatReview(inserted.rows[0]);
  }

  async recordExternalEvent(companyId, assessmentId, userId, input = {}) {
    if (!UUID_REGEX.test(text(assessmentId))) return null;
    const eventType = text(input.eventType || input.event_type).toLowerCase(); const externalReference = text(input.externalReference || input.external_reference);
    const actorName = text(input.actorName || input.actor_name); const occurredAt = input.occurredAt || input.occurred_at;
    const evidenceDocumentId = text(input.evidenceDocumentId || input.evidence_document_id);
    if (!EVENT_EVIDENCE_TYPES[eventType] || !externalReference || !actorName || !occurredAt || !UUID_REGEX.test(evidenceDocumentId)) {
      return { blocked: true, code: 'EPR_EXTERNAL_EVENT_INVALID', message: 'Supported type, external reference, actor, timestamp and evidence are required.' };
    }
    const occurredAtDate = new Date(occurredAt);
    if (Number.isNaN(occurredAtDate.getTime())) return { blocked: true, code: 'EPR_EXTERNAL_EVENT_DATE_INVALID',
      message: 'External-event timestamp must be a valid date and time.' };
    const register = await this.list(companyId); if (!register) return null;
    const assessment = register.find((item) => item.id === assessmentId); if (!assessment) return null;
    if (assessment.assessmentStatus !== 'approved_for_internal_planning' && assessment.assessmentStatus !== 'external_evidence_recorded') {
      return { blocked: true, code: 'EPR_EXTERNAL_EVENT_NOT_READY', message: 'External evidence can only bind to the latest internally approved assessment.' };
    }
    const evidence = await this._loadEvidence(companyId, [evidenceDocumentId]); const item = evidence[0];
    if (!item || !EVENT_EVIDENCE_TYPES[eventType].includes(item.type)) return { blocked: true, code: 'EPR_EXTERNAL_EVENT_EVIDENCE_TYPE_MISMATCH',
      message: `Event ${eventType} requires ${EVENT_EVIDENCE_TYPES[eventType].join(' or ')} evidence.` };
    if (!['locked', 'third_party_verified'].includes(item.status) || !/^[a-f0-9]{64}$/i.test(item.checksumSha256)
      || item.fileSizeBytes <= 0) return { blocked: true, code: 'EPR_EXTERNAL_EVENT_EVIDENCE_NOT_CONTROLLED',
      message: 'External-event evidence must be locked, checksum identified and non-empty.' };
    const periodStart = dateOnly(input.reportingPeriodStart || input.reporting_period_start);
    const periodEnd = dateOnly(input.reportingPeriodEnd || input.reporting_period_end);
    if (eventType === 'report_submission_confirmed' && (!periodStart || !periodEnd || periodEnd < periodStart)) return { blocked: true,
      code: 'EPR_EXTERNAL_EVENT_PERIOD_REQUIRED', message: 'Submission confirmation requires a valid reporting period.' };
    if (eventType === 'report_submission_confirmed'
      && (periodStart !== assessment.reportingPeriodStart || periodEnd !== assessment.reportingPeriodEnd)) return { blocked: true,
      code: 'EPR_EXTERNAL_EVENT_PERIOD_MISMATCH', message: 'Submission confirmation must match the assessment reporting period.' };
    const amount = input.amount === '' || input.amount === undefined || input.amount === null ? null : Number(input.amount);
    const currency = text(input.currency).toUpperCase() || null;
    if (eventType === 'fee_payment_confirmed' && (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency || ''))) {
      return { blocked: true, code: 'EPR_EXTERNAL_EVENT_PAYMENT_REQUIRED', message: 'Payment confirmation requires non-negative amount and ISO currency.' };
    }
    const inserted = await this.database.query(
      `INSERT INTO eu_textile_epr_external_events (company_id, assessment_id, event_type, external_reference,
         actor_name, occurred_at, amount, currency, reporting_period_start, reporting_period_end, evidence_document_id,
         evidence_snapshot, input_sha256, shipment_snapshot_sha256, result_sha256, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *`,
      [companyId, assessmentId, eventType, externalReference, actorName, occurredAtDate.toISOString(), amount, currency, periodStart, periodEnd,
        evidenceDocumentId, JSON.stringify(evidence), assessment.inputSha256, assessment.shipmentSnapshotSha256,
        assessment.resultSha256, userId]
    );
    return this._formatEvent(inserted.rows[0]);
  }

  _formatAssessment(row, currentEvidence = [], rawEvents = []) {
    const latestReview = row.latest_review ? this._formatReview(row.latest_review) : null;
    const externalEvents = rawEvents.map((item) => this._formatEvent(item));
    const derived = Number(row.latest_revision || row.revision) !== Number(row.revision)
      ? { status: 'superseded', staleEvidenceIds: [], externalMilestones: [] }
      : deriveEprStatus({ result_snapshot: row.result_snapshot, latest_review: latestReview }, currentEvidence, externalEvents);
    return { id: row.id, assessmentReference: row.assessment_reference, revision: Number(row.revision), memberState: row.member_state,
      rulesetId: row.ruleset_id, rulesetVersion: row.ruleset_version, rulesetCoverage: row.ruleset_coverage,
      sourceManifestSha256: row.source_manifest_sha256, assessmentDate: dateOnly(row.assessment_date),
      reportingPeriodStart: dateOnly(row.reporting_period_start), reportingPeriodEnd: dateOnly(row.reporting_period_end),
      input: row.input_snapshot, inputSha256: row.input_sha256, shipmentSnapshot: row.shipment_snapshot,
      shipmentSnapshotSha256: row.shipment_snapshot_sha256, result: row.result_snapshot, resultSha256: row.result_sha256,
      evidenceSnapshot: row.evidence_snapshot, automatedStatus: row.automated_status, assessmentStatus: derived.status,
      staleEvidenceIds: derived.staleEvidenceIds, externalMilestones: derived.externalMilestones,
      latestReview, externalEvents, createdBy: row.created_by, createdAt: row.created_at };
  }

  _formatReview(row) { return { id: row.id, assessmentId: row.assessment_id, reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name_snapshot, reviewerEmail: row.reviewer_email_snapshot, reviewerRole: row.reviewer_role,
    decision: row.decision, notes: row.notes, inputSha256: row.input_sha256,
    shipmentSnapshotSha256: row.shipment_snapshot_sha256, resultSha256: row.result_sha256,
    evidenceSnapshot: row.evidence_snapshot, createdAt: row.created_at }; }
  _formatEvent(row) { return { id: row.id, assessmentId: row.assessment_id, eventType: row.event_type,
    externalReference: row.external_reference, actorName: row.actor_name, occurredAt: row.occurred_at, amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency, reportingPeriodStart: dateOnly(row.reporting_period_start), reportingPeriodEnd: dateOnly(row.reporting_period_end),
    evidenceDocumentId: row.evidence_document_id, evidenceSnapshot: row.evidence_snapshot,
    inputSha256: row.input_sha256, shipmentSnapshotSha256: row.shipment_snapshot_sha256,
    resultSha256: row.result_sha256, recordedBy: row.recorded_by, createdAt: row.created_at }; }
}

module.exports = { EuTextileEprService, euTextileEprService: new EuTextileEprService(), RULESET, EVENT_EVIDENCE_TYPES };
