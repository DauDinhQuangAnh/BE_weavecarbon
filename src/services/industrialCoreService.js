const pool = require('../config/database');
const { getCapabilityRegistry, validateFacilityInput, validateActivityInput } = require('./industrialCoreControls');

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
}

module.exports = { IndustrialCoreService, industrialCoreService: new IndustrialCoreService() };
