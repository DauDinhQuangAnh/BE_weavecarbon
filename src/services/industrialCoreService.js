const pool = require('../config/database');
const { getCapabilityRegistry, validateFacilityInput, validateActivityInput, validateProcessInput,
  validateMeasurementPointInput, validateActivityReviewInput } = require('./industrialCoreControls');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateTime(value) { return value instanceof Date ? value.toISOString() : value; }

class IndustrialCoreService {
  constructor(database = pool) { this.database = database; }

  capabilities() { return getCapabilityRegistry(); }

  async _companyExists(companyId) {
    const result = await this.database.query('SELECT id FROM companies WHERE id=$1', [companyId]);
    return Boolean(result.rows[0]);
  }

  async listFacilities(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT facility.* FROM industrial_facility_revisions facility
       WHERE facility.company_id=$1 ORDER BY facility.created_at DESC, facility.id DESC`, [companyId]);
    return result.rows.map((row) => this._formatFacility(row));
  }

  async createFacility(companyId, userId, input = {}) {
    if (!(await this._companyExists(companyId))) return null;
    const { value, errors } = validateFacilityInput(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_FACILITY_INVALID', message: errors.join(' '), details: errors };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:facility:${value.facilityReference}`]);
      const next = await client.query(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industrial_facility_revisions
         WHERE company_id=$1 AND facility_reference=$2`, [companyId, value.facilityReference]);
      const inserted = await client.query(
        `INSERT INTO industrial_facility_revisions (company_id, facility_reference, revision, name, country_code,
           timezone, lifecycle_status, boundary_notes, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
        [companyId, value.facilityReference, Number(next.rows[0].revision), value.name, value.countryCode,
          value.timezone, value.lifecycleStatus, value.boundaryNotes, JSON.stringify(value.metadata), userId]);
      await client.query('COMMIT'); return this._formatFacility(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listProcesses(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT process.*, facility.facility_reference, facility.name AS facility_name
       FROM industrial_process_revisions process JOIN industrial_facility_revisions facility
         ON facility.id=process.facility_revision_id AND facility.company_id=process.company_id
       WHERE process.company_id=$1 ORDER BY process.created_at DESC, process.id DESC`, [companyId]);
    return result.rows.map((row) => this._formatProcess(row));
  }

  async createProcess(companyId, userId, input = {}) {
    if (!(await this._companyExists(companyId))) return null;
    const { value, errors } = validateProcessInput(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_PROCESS_INVALID', message: errors.join(' '), details: errors };
    const facility = await this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId, companyId]);
    if (!facility.rows[0]) return { blocked: true, code: 'INDUSTRIAL_PROCESS_REFERENCE_INVALID', message: 'Facility revision must belong to the active company.' };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:process:${value.processReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industrial_process_revisions WHERE company_id=$1 AND process_reference=$2', [companyId, value.processReference]);
      const inserted = await client.query(
        `INSERT INTO industrial_process_revisions (company_id, facility_revision_id, process_reference, revision,
           name, process_type, lifecycle_status, metadata, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
        [companyId, value.facilityRevisionId, value.processReference, Number(next.rows[0].revision), value.name,
          value.processType, value.lifecycleStatus, JSON.stringify(value.metadata), userId]);
      await client.query('COMMIT'); return this._formatProcess(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listMeasurementPoints(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT point.*, facility.facility_reference, process.process_reference
       FROM industrial_measurement_point_revisions point
       JOIN industrial_facility_revisions facility ON facility.id=point.facility_revision_id AND facility.company_id=point.company_id
       LEFT JOIN industrial_process_revisions process ON process.id=point.process_revision_id AND process.company_id=point.company_id
       WHERE point.company_id=$1 ORDER BY point.created_at DESC, point.id DESC`, [companyId]);
    return result.rows.map((row) => this._formatMeasurementPoint(row));
  }

  async createMeasurementPoint(companyId, userId, input = {}) {
    if (!(await this._companyExists(companyId))) return null;
    const { value, errors } = validateMeasurementPointInput(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_MEASUREMENT_POINT_INVALID', message: errors.join(' '), details: errors };
    const [facility, process] = await Promise.all([
      this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId, companyId]),
      value.processRevisionId ? this.database.query('SELECT id, facility_revision_id FROM industrial_process_revisions WHERE id=$1 AND company_id=$2', [value.processRevisionId, companyId]) : Promise.resolve({ rows: [{}] })
    ]);
    if (!facility.rows[0] || !process.rows[0] || (value.processRevisionId && process.rows[0].facility_revision_id !== value.facilityRevisionId)) {
      return { blocked: true, code: 'INDUSTRIAL_MEASUREMENT_POINT_REFERENCE_INVALID', message: 'Facility and process revisions must belong to the active company and the same facility.' };
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:measurement:${value.measurementPointReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industrial_measurement_point_revisions WHERE company_id=$1 AND measurement_point_reference=$2', [companyId, value.measurementPointReference]);
      const inserted = await client.query(
        `INSERT INTO industrial_measurement_point_revisions (company_id, facility_revision_id, process_revision_id,
           measurement_point_reference, revision, measurement_type, canonical_unit, source_type, device_identity,
           calibration_status, calibration_due_on, sampling_interval_seconds, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING *`,
        [companyId, value.facilityRevisionId, value.processRevisionId, value.measurementPointReference,
          Number(next.rows[0].revision), value.measurementType, value.canonicalUnit, value.sourceType,
          value.deviceIdentity, value.calibrationStatus, value.calibrationDueOn, value.samplingIntervalSeconds,
          JSON.stringify(value.metadata), userId]);
      await client.query('COMMIT'); return this._formatMeasurementPoint(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listActivities(companyId, limit = 100) {
    if (!(await this._companyExists(companyId))) return null;
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
    const result = await this.database.query(
      `SELECT activity.*, facility.facility_reference, facility.name AS facility_name
       FROM industrial_activity_records activity
       JOIN industrial_facility_revisions facility
         ON facility.id=activity.facility_revision_id AND facility.company_id=activity.company_id
       WHERE activity.company_id=$1 ORDER BY activity.period_start DESC, activity.created_at DESC LIMIT $2`,
      [companyId, safeLimit]);
    return result.rows.map((row) => this._formatActivity(row));
  }

  async createActivity(companyId, userId, input = {}) {
    if (!(await this._companyExists(companyId))) return null;
    const { value, errors } = validateActivityInput(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_ACTIVITY_INVALID', message: errors.join(' '), details: errors };
    const evidenceIds = value.evidenceDocumentIds;
    const references = await Promise.all([
      this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId, companyId]),
      value.processRevisionId ? this.database.query('SELECT id FROM industrial_process_revisions WHERE id=$1 AND company_id=$2', [value.processRevisionId, companyId]) : Promise.resolve({ rows: [{}] }),
      value.measurementPointRevisionId ? this.database.query('SELECT id FROM industrial_measurement_point_revisions WHERE id=$1 AND company_id=$2', [value.measurementPointRevisionId, companyId]) : Promise.resolve({ rows: [{}] }),
      evidenceIds.length ? this.database.query('SELECT id FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[])', [companyId, evidenceIds]) : Promise.resolve({ rows: [] })
    ]);
    if (!references[0].rows[0] || !references[1].rows[0] || !references[2].rows[0] || references[3].rows.length !== evidenceIds.length) {
      return { blocked: true, code: 'INDUSTRIAL_ACTIVITY_REFERENCE_INVALID', message: 'Every facility, process, measurement point and evidence reference must belong to the active company.' };
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO industrial_activity_records (company_id, facility_revision_id, process_revision_id,
           measurement_point_revision_id, activity_reference, activity_type, period_start, period_end, quantity,
           canonical_unit, source_kind, data_quality_level, raw_payload, source_sha256, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING *`,
        [companyId, value.facilityRevisionId, value.processRevisionId, value.measurementPointRevisionId,
          value.activityReference, value.activityType, value.periodStart, value.periodEnd, value.quantity,
          value.canonicalUnit, value.sourceKind, value.dataQualityLevel, JSON.stringify(value.rawPayload), value.sourceSha256, userId]);
      for (const evidenceId of evidenceIds) {
        await client.query(
          `INSERT INTO industrial_activity_evidence (company_id, activity_id, evidence_document_id, linked_by)
           VALUES ($1,$2,$3,$4)`, [companyId, inserted.rows[0].id, evidenceId, userId]);
      }
      await client.query('COMMIT');
      return this._formatActivity({ ...inserted.rows[0], evidence_document_ids: evidenceIds });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async getActivityLineage(companyId, activityId) {
    if (!UUID_REGEX.test(String(activityId || ''))) return null;
    const result = await this.database.query(
      `SELECT activity.*, facility.facility_reference, facility.name AS facility_name,
              process.process_reference, process.name AS process_name,
              point.measurement_point_reference, point.measurement_type,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', evidence.id, 'name', evidence.document_name,
                'type', evidence.evidence_type, 'status', evidence.status, 'checksumSha256', evidence.checksum_sha256)
                ORDER BY evidence.id) FROM industrial_activity_evidence link
                JOIN evidence_documents evidence ON evidence.id=link.evidence_document_id AND evidence.company_id=link.company_id
                WHERE link.activity_id=activity.id AND link.company_id=activity.company_id), '[]'::jsonb) AS evidence,
              (SELECT to_jsonb(review) FROM industrial_activity_reviews review
                WHERE review.activity_id=activity.id AND review.company_id=activity.company_id
                ORDER BY review.created_at DESC, review.id DESC LIMIT 1) AS latest_review
       FROM industrial_activity_records activity
       JOIN industrial_facility_revisions facility ON facility.id=activity.facility_revision_id AND facility.company_id=activity.company_id
       LEFT JOIN industrial_process_revisions process ON process.id=activity.process_revision_id AND process.company_id=activity.company_id
       LEFT JOIN industrial_measurement_point_revisions point ON point.id=activity.measurement_point_revision_id AND point.company_id=activity.company_id
       WHERE activity.id=$1 AND activity.company_id=$2`, [activityId, companyId]);
    const row = result.rows[0]; if (!row) return null;
    return { activity: this._formatActivity(row), facility: { id: row.facility_revision_id, reference: row.facility_reference, name: row.facility_name },
      process: row.process_revision_id ? { id: row.process_revision_id, reference: row.process_reference, name: row.process_name } : null,
      measurementPoint: row.measurement_point_revision_id ? { id: row.measurement_point_revision_id, reference: row.measurement_point_reference, type: row.measurement_type } : null,
      evidence: row.evidence || [], latestReview: row.latest_review ? this._formatReview(row.latest_review) : null };
  }

  async reviewActivity(companyId, activityId, userId, input = {}) {
    if (!UUID_REGEX.test(String(activityId || ''))) return null;
    const { value, errors } = validateActivityReviewInput(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_ACTIVITY_REVIEW_INVALID', message: errors.join(' '), details: errors };
    const lineage = await this.getActivityLineage(companyId, activityId); if (!lineage) return null;
    if (value.decision === 'approved' && (!lineage.evidence.length || lineage.evidence.some((item) => !['locked', 'third_party_verified'].includes(item.status)))) {
      return { blocked: true, code: 'INDUSTRIAL_ACTIVITY_EVIDENCE_NOT_LOCKED', message: 'Approval requires at least one locked or third-party-verified evidence document.' };
    }
    const reviewerResult = await this.database.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
    const reviewer = reviewerResult.rows[0]; if (!reviewer) return { blocked: true, code: 'INDUSTRIAL_ACTIVITY_REVIEWER_NOT_FOUND', message: 'Named reviewer identity is required.' };
    const inserted = await this.database.query(
      `INSERT INTO industrial_activity_reviews (company_id, activity_id, reviewer_id, reviewer_name_snapshot,
         reviewer_role, decision, notes, source_sha256, evidence_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
      [companyId, activityId, userId, reviewer.full_name || reviewer.email, value.reviewerRole, value.decision,
        value.notes, lineage.activity.sourceSha256, JSON.stringify(lineage.evidence)]);
    return this._formatReview(inserted.rows[0]);
  }

  _formatFacility(row) {
    return { id: row.id, facilityReference: row.facility_reference, revision: Number(row.revision), name: row.name,
      countryCode: row.country_code, timezone: row.timezone, lifecycleStatus: row.lifecycle_status,
      boundaryNotes: row.boundary_notes, metadata: row.metadata, createdBy: row.created_by, createdAt: dateTime(row.created_at) };
  }

  _formatActivity(row) {
    return { id: row.id, activityReference: row.activity_reference, facilityRevisionId: row.facility_revision_id,
      facilityReference: row.facility_reference, facilityName: row.facility_name, processRevisionId: row.process_revision_id,
      measurementPointRevisionId: row.measurement_point_revision_id, activityType: row.activity_type,
      periodStart: dateTime(row.period_start), periodEnd: dateTime(row.period_end), quantity: Number(row.quantity),
      canonicalUnit: row.canonical_unit, sourceKind: row.source_kind, dataQualityLevel: row.data_quality_level,
      rawPayload: row.raw_payload, sourceSha256: row.source_sha256, evidenceDocumentIds: row.evidence_document_ids || [],
      createdBy: row.created_by, createdAt: dateTime(row.created_at) };
  }

  _formatProcess(row) {
    return { id: row.id, facilityRevisionId: row.facility_revision_id, facilityReference: row.facility_reference,
      facilityName: row.facility_name, processReference: row.process_reference, revision: Number(row.revision),
      name: row.name, processType: row.process_type, lifecycleStatus: row.lifecycle_status, metadata: row.metadata,
      createdBy: row.created_by, createdAt: dateTime(row.created_at) };
  }

  _formatMeasurementPoint(row) {
    return { id: row.id, facilityRevisionId: row.facility_revision_id, facilityReference: row.facility_reference,
      processRevisionId: row.process_revision_id, processReference: row.process_reference,
      measurementPointReference: row.measurement_point_reference, revision: Number(row.revision),
      measurementType: row.measurement_type, canonicalUnit: row.canonical_unit, sourceType: row.source_type,
      deviceIdentity: row.device_identity, calibrationStatus: row.calibration_status,
      calibrationDueOn: row.calibration_due_on, samplingIntervalSeconds: row.sampling_interval_seconds,
      metadata: row.metadata, createdBy: row.created_by, createdAt: dateTime(row.created_at) };
  }

  _formatReview(row) {
    return { id: row.id, activityId: row.activity_id, reviewerId: row.reviewer_id,
      reviewerName: row.reviewer_name_snapshot, reviewerRole: row.reviewer_role, decision: row.decision,
      notes: row.notes, sourceSha256: row.source_sha256, evidenceSnapshot: row.evidence_snapshot,
      createdAt: dateTime(row.created_at) };
  }
}

module.exports = { IndustrialCoreService, industrialCoreService: new IndustrialCoreService() };
