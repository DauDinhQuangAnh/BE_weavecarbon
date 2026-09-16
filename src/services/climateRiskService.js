const pool = require('../config/database');
const controls = require('./climateRiskControls');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = (code, message, status = 422) => ({ blocked: true, code, message, status });
const evidenceSnapshot = (row) => ({ id: row.id, name: row.document_name, status: row.status,
  checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes) });
const evidenceValid = (row) => row && ['locked', 'third_party_verified'].includes(row.status) &&
  /^[a-f0-9]{64}$/i.test(row.checksum_sha256 || '') && Number(row.file_size_bytes) > 0;
const isoDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

class ClimateRiskService {
  constructor(database = pool) { this.database = database; }

  async _evidence(companyId, evidenceId) {
    const result = await this.database.query(
      'SELECT id,document_name,status,checksum_sha256,file_size_bytes FROM evidence_documents WHERE id=$1 AND company_id=$2',
      [evidenceId, companyId]);
    return evidenceValid(result.rows[0]) ? result.rows[0] : null;
  }

  async listLocations(companyId) {
    const result = await this.database.query(
      `SELECT l.*,f.facility_reference,f.name AS facility_name FROM climate_risk_location_revisions l
       JOIN industrial_facility_revisions f ON f.id=l.facility_revision_id AND f.company_id=l.company_id
       WHERE l.company_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 200`, [companyId]);
    return result.rows.map((row) => ({ id: row.id, facilityRevisionId: row.facility_revision_id,
      facilityReference: row.facility_reference, facilityName: row.facility_name, latitude: Number(row.latitude),
      longitude: Number(row.longitude), precisionMeters: row.precision_meters, locationBasis: row.location_basis,
      evidenceSnapshot: row.evidence_snapshot, createdAt: row.created_at }));
  }

  async createLocation(companyId, userId, input) {
    const parsed = controls.location(input);
    if (parsed.errors.length) return blocked('CLIMATE_LOCATION_INVALID', parsed.errors.join(' '));
    const [facility, evidence] = await Promise.all([
      this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [parsed.value.facilityRevisionId, companyId]),
      this._evidence(companyId, parsed.value.evidenceDocumentId)
    ]);
    if (!facility.rows[0] || !evidence) return blocked('CLIMATE_LOCATION_REFERENCE_INVALID', 'A tenant-bound facility and locked, checksummed location evidence are required.');
    const result = await this.database.query(
      `INSERT INTO climate_risk_location_revisions(company_id,facility_revision_id,latitude,longitude,precision_meters,
         location_basis,evidence_document_id,evidence_snapshot,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id,facility_revision_id,latitude,longitude,precision_meters,evidence_snapshot,created_at`,
      [companyId, parsed.value.facilityRevisionId, parsed.value.latitude, parsed.value.longitude,
        parsed.value.precisionMeters, parsed.value.locationBasis, evidence.id, JSON.stringify(evidenceSnapshot(evidence)), userId]);
    const row = result.rows[0];
    return { id: row.id, facilityRevisionId: row.facility_revision_id, latitude: Number(row.latitude),
      longitude: Number(row.longitude), precisionMeters: row.precision_meters, evidenceSnapshot: row.evidence_snapshot, createdAt: row.created_at };
  }

  async listAssessments(companyId, limit = 200) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);
    const result = await this.database.query(
      `SELECT a.*,f.facility_reference,f.name AS facility_name FROM climate_risk_assessments a
       JOIN industrial_facility_revisions f ON f.id=a.facility_revision_id AND f.company_id=a.company_id
       WHERE a.company_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT $2`, [companyId, safeLimit]);
    return result.rows.map((row) => this._assessment(row));
  }

  async createAssessment(companyId, userId, input) {
    const parsed = controls.assessment(input);
    if (parsed.errors.length) return blocked('CLIMATE_ASSESSMENT_INVALID', parsed.errors.join(' '));
    const [location, evidence] = await Promise.all([
      this.database.query(
        `SELECT l.id FROM climate_risk_location_revisions l JOIN evidence_documents e
         ON e.id=l.evidence_document_id AND e.company_id=l.company_id
         WHERE l.id=$1 AND l.company_id=$2 AND l.facility_revision_id=$3
           AND e.status IN ('locked','third_party_verified') AND e.checksum_sha256=l.evidence_snapshot->>'checksumSha256'
           AND e.file_size_bytes > 0`,
        [parsed.value.locationRevisionId, companyId, parsed.value.facilityRevisionId]),
      this._evidence(companyId, parsed.value.evidenceDocumentId)
    ]);
    if (!location.rows[0] || !evidence) return blocked('CLIMATE_ASSESSMENT_REFERENCE_INVALID', 'A tenant-bound, evidence-backed site location and locked source evidence are required.');
    const v = parsed.value;
    const fingerprint = controls.sha({ companyId, ...v, evidenceChecksum: evidence.checksum_sha256 });
    const result = await this.database.query(
      `INSERT INTO climate_risk_assessments(company_id,facility_revision_id,location_revision_id,hazard_type,scenario_kind,
         scenario_reference,horizon_start,horizon_end,source_kind,source_url,dataset_identifier,dataset_version,
         spatial_resolution,temporal_resolution,grid_reference,spatial_match_notes,model_name,scenario_name,hazard_metric,metric_value,metric_unit,
         uncertainty_notes,exposure_rating,vulnerability_rating,business_dependency_percent,priority_band,
         rating_rationale,evidence_document_id,evidence_snapshot,input_sha256,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30,$31)
       RETURNING *`,
      [companyId, v.facilityRevisionId, v.locationRevisionId, v.hazardType, v.scenarioKind, v.scenarioReference,
        v.horizonStart, v.horizonEnd, v.sourceKind, v.sourceUrl, v.datasetIdentifier, v.datasetVersion,
        v.spatialResolution, v.temporalResolution, v.gridReference, v.spatialMatchNotes, v.modelName || null, v.scenarioName || null, v.hazardMetric,
        v.metricValue, v.metricUnit, v.uncertaintyNotes, v.exposureRating, v.vulnerabilityRating,
        v.businessDependencyPercent, v.priorityBand, v.ratingRationale, evidence.id,
        JSON.stringify(evidenceSnapshot(evidence)), fingerprint, userId]);
    return this._assessment(result.rows[0]);
  }

  async listPortfolios(companyId) {
    const result = await this.database.query(
      `SELECT * FROM climate_risk_portfolio_snapshots WHERE company_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [companyId]);
    return result.rows.map((row) => this._portfolio(row));
  }

  async getPortfolio(companyId, portfolioId) {
    if (!UUID.test(portfolioId)) return null;
    const result = await this.database.query('SELECT * FROM climate_risk_portfolio_snapshots WHERE id=$1 AND company_id=$2', [portfolioId, companyId]);
    if (!result.rows[0]) return null;
    const members = await this.database.query(
      `SELECT a.*,f.facility_reference,f.name AS facility_name FROM climate_risk_portfolio_members m
       JOIN climate_risk_assessments a ON a.id=m.assessment_id AND a.company_id=m.company_id
       JOIN industrial_facility_revisions f ON f.id=m.facility_revision_id AND f.company_id=m.company_id
       WHERE m.portfolio_id=$1 AND m.company_id=$2 ORDER BY f.facility_reference,a.hazard_type`, [portfolioId, companyId]);
    return { ...this._portfolio(result.rows[0]), assessments: members.rows.map((row) => this._assessment(row)) };
  }

  async createPortfolio(companyId, userId, input) {
    const parsed = controls.portfolio(input);
    if (parsed.errors.length) return blocked('CLIMATE_PORTFOLIO_INVALID', parsed.errors.join(' '));
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT a.*,f.facility_reference,
                e.status AS current_evidence_status,e.checksum_sha256 AS current_evidence_sha256,e.file_size_bytes AS current_evidence_size,
                le.status AS current_location_status,le.checksum_sha256 AS current_location_sha256,le.file_size_bytes AS current_location_size,
                l.evidence_snapshot AS location_evidence_snapshot
         FROM climate_risk_assessments a JOIN evidence_documents e ON e.id=a.evidence_document_id AND e.company_id=a.company_id
         JOIN climate_risk_location_revisions l ON l.id=a.location_revision_id AND l.company_id=a.company_id
         JOIN evidence_documents le ON le.id=l.evidence_document_id AND le.company_id=l.company_id
         JOIN industrial_facility_revisions f ON f.id=a.facility_revision_id AND f.company_id=a.company_id
         WHERE a.company_id=$1 AND a.id=ANY($2::uuid[])`, [companyId, parsed.value.assessmentIds]);
      const rows = result.rows;
      if (rows.length !== parsed.value.assessmentIds.length || rows.some((row) =>
        !['locked', 'third_party_verified'].includes(row.current_evidence_status) ||
        row.current_evidence_sha256 !== row.evidence_snapshot?.checksumSha256 || Number(row.current_evidence_size) <= 0 ||
        !['locked', 'third_party_verified'].includes(row.current_location_status) ||
        row.current_location_sha256 !== row.location_evidence_snapshot?.checksumSha256 || Number(row.current_location_size) <= 0)) {
        await client.query('ROLLBACK'); return blocked('CLIMATE_PORTFOLIO_EVIDENCE_INVALID', 'Every assessment and location must belong to the company and retain locked, checksummed evidence.');
      }
      const first = rows[0];
      const sameScenario = rows.every((row) => row.scenario_kind === first.scenario_kind &&
        row.source_kind === first.source_kind &&
        row.scenario_reference === first.scenario_reference && isoDate(row.horizon_start) === isoDate(first.horizon_start) &&
        isoDate(row.horizon_end) === isoDate(first.horizon_end) &&
        (first.scenario_kind !== 'projection' || (row.model_name === first.model_name && row.scenario_name === first.scenario_name)));
      const facilities = new Map();
      const seenHazards = new Set();
      for (const row of rows) {
        const key = `${row.facility_reference}:${row.hazard_type}`;
        if (seenHazards.has(key)) { await client.query('ROLLBACK'); return blocked('CLIMATE_PORTFOLIO_DUPLICATE_HAZARD', 'Only one assessment per facility and hazard is allowed.'); }
        seenHazards.add(key);
        const existing = facilities.get(row.facility_reference);
        if (existing && existing.revisionId !== row.facility_revision_id) { await client.query('ROLLBACK'); return blocked('CLIMATE_PORTFOLIO_FACILITY_REVISION_CONFLICT', 'A portfolio cannot combine revisions of the same facility.'); }
        if (existing && Number(existing.dependency) !== Number(row.business_dependency_percent)) { await client.query('ROLLBACK'); return blocked('CLIMATE_PORTFOLIO_DEPENDENCY_CONFLICT', 'One facility must have one consistent business-dependency percentage.'); }
        const band = { low: 1, medium: 2, high: 3 };
        facilities.set(row.facility_reference, { revisionId: row.facility_revision_id, dependency: Number(row.business_dependency_percent),
          priority: !existing || band[row.priority_band] > band[existing.priority] ? row.priority_band : existing.priority,
          hazardCount: (existing?.hazardCount || 0) + 1 });
      }
      const totalDependencyMillis = [...facilities.values()].reduce((sum, facility) => sum + Math.round(facility.dependency * 1000), 0);
      if (!sameScenario || facilities.size < 2 || totalDependencyMillis !== 100000) {
        await client.query('ROLLBACK'); return blocked('CLIMATE_PORTFOLIO_SCOPE_INVALID', 'Assessments need one scenario/horizon, at least two facilities, and facility dependency percentages totaling 100.');
      }
      const summary = { method: 'worst_author_assigned_band_per_facility', reviewStatus: 'needs_specialist_review',
        facilityCount: facilities.size, assessmentCount: rows.length, dependencyPercentByPriority: { low: 0, medium: 0, high: 0 },
        facilityCountByPriority: { low: 0, medium: 0, high: 0 }, incompleteHazardCoverageFacilities: 0 };
      for (const facility of facilities.values()) {
        summary.dependencyPercentByPriority[facility.priority] += facility.dependency;
        summary.facilityCountByPriority[facility.priority] += 1;
        if (facility.hazardCount < 3) summary.incompleteHazardCoverageFacilities += 1;
      }
      for (const band of ['low', 'medium', 'high']) summary.dependencyPercentByPriority[band] = Number(summary.dependencyPercentByPriority[band].toFixed(3));
      const fingerprint = controls.sha({ companyId, portfolioReference: parsed.value.portfolioReference,
        assessmentIds: [...parsed.value.assessmentIds].sort(), methodologyNotes: parsed.value.methodologyNotes });
      const inserted = await client.query(
        `INSERT INTO climate_risk_portfolio_snapshots(company_id,portfolio_reference,scenario_kind,scenario_reference,
           horizon_start,horizon_end,facility_count,assessment_count,priority_summary,methodology_notes,input_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) RETURNING *`,
        [companyId, parsed.value.portfolioReference, first.scenario_kind, first.scenario_reference,
          first.horizon_start, first.horizon_end, facilities.size, rows.length, JSON.stringify(summary),
          parsed.value.methodologyNotes, fingerprint, userId]);
      for (const row of rows) await client.query(
        `INSERT INTO climate_risk_portfolio_members(company_id,portfolio_id,assessment_id,facility_revision_id,hazard_type)
         VALUES($1,$2,$3,$4,$5)`, [companyId, inserted.rows[0].id, row.id, row.facility_revision_id, row.hazard_type]);
      await client.query('COMMIT'); return this._portfolio(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return blocked('CLIMATE_PORTFOLIO_DUPLICATE', 'An identical portfolio snapshot already exists.', 409);
      throw error;
    } finally { client.release(); }
  }

  _assessment(row) {
    return { id: row.id, facilityRevisionId: row.facility_revision_id, facilityReference: row.facility_reference,
      facilityName: row.facility_name, locationRevisionId: row.location_revision_id, hazardType: row.hazard_type,
      scenarioKind: row.scenario_kind, scenarioReference: row.scenario_reference, horizonStart: isoDate(row.horizon_start),
      horizonEnd: isoDate(row.horizon_end), sourceKind: row.source_kind, sourceUrl: row.source_url,
      datasetIdentifier: row.dataset_identifier, datasetVersion: row.dataset_version,
      spatialResolution: row.spatial_resolution, temporalResolution: row.temporal_resolution,
      gridReference: row.grid_reference, spatialMatchNotes: row.spatial_match_notes,
      modelName: row.model_name, scenarioName: row.scenario_name, hazardMetric: row.hazard_metric,
      metricValue: Number(row.metric_value), metricUnit: row.metric_unit, uncertaintyNotes: row.uncertainty_notes,
      exposureRating: row.exposure_rating, vulnerabilityRating: row.vulnerability_rating,
      businessDependencyPercent: Number(row.business_dependency_percent), priorityBand: row.priority_band,
      ratingRationale: row.rating_rationale, screeningStatus: row.screening_status,
      evidenceSnapshot: row.evidence_snapshot, inputSha256: row.input_sha256, createdAt: row.created_at };
  }

  _portfolio(row) {
    return { id: row.id, portfolioReference: row.portfolio_reference, scenarioKind: row.scenario_kind,
      scenarioReference: row.scenario_reference, horizonStart: isoDate(row.horizon_start), horizonEnd: isoDate(row.horizon_end),
      facilityCount: row.facility_count, assessmentCount: row.assessment_count, prioritySummary: row.priority_summary,
      methodologyNotes: row.methodology_notes, inputSha256: row.input_sha256, createdAt: row.created_at };
  }
}

module.exports = { ClimateRiskService, climateRiskService: new ClimateRiskService() };
