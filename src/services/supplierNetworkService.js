const pool = require('../config/database');
const controls = require('./supplierNetworkControls');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = (code, message, status = 422) => ({ blocked: true, code, message, status });
const isoDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const evidenceValid = (row, prefix = '') => row && ['locked', 'third_party_verified'].includes(row[`${prefix}status`]) &&
  /^[a-f0-9]{64}$/i.test(row[`${prefix}checksum_sha256`] || '') && Number(row[`${prefix}file_size_bytes`]) > 0;
const evidenceSnapshot = (row) => ({ id: row.id, documentName: row.document_name, status: row.status,
  checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes) });

class SupplierNetworkService {
  constructor(database = pool) { this.database = database; }

  async _evidence(companyId, evidenceId, database = this.database) {
    const result = await database.query(
      'SELECT id,document_name,status,checksum_sha256,file_size_bytes FROM evidence_documents WHERE id=$1 AND company_id=$2',
      [evidenceId, companyId]);
    return evidenceValid(result.rows[0]) ? result.rows[0] : null;
  }

  async _revisionInsert({ companyId, lockKey, revisionTable, referenceColumn, referenceValue, insert, duplicateCode }) {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:${lockKey}:${referenceValue}`]);
      const next = await client.query(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM ${revisionTable} WHERE company_id=$1 AND ${referenceColumn}=$2`, [companyId, referenceValue]);
      const row = await insert(client, Number(next.rows[0].revision));
      await client.query('COMMIT'); return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return blocked(duplicateCode, 'An identical revision already exists.', 409);
      throw error;
    } finally { client.release(); }
  }

  async listProfiles(companyId) {
    const result = await this.database.query(
      `SELECT * FROM industrial_supplier_revisions WHERE company_id=$1 ORDER BY supplier_reference,revision DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._profile(row));
  }

  async createProfile(companyId, userId, input) {
    const parsed = controls.profile(input);
    if (parsed.errors.length) return blocked('SUPPLIER_PROFILE_INVALID', parsed.errors.join(' '));
    const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId);
    if (!evidence) return blocked('SUPPLIER_PROFILE_EVIDENCE_INVALID', 'Locked, checksummed supplier identity evidence is required.');
    const snapshot = evidenceSnapshot(evidence); const v = parsed.value;
    return this._revisionInsert({ companyId, lockKey: 'supplier-profile', revisionTable: 'industrial_supplier_revisions',
      referenceColumn: 'supplier_reference', referenceValue: v.supplierReference, duplicateCode: 'SUPPLIER_PROFILE_DUPLICATE',
      insert: async (client, revision) => {
        const payload = { ...v, revision, evidenceSnapshot: snapshot };
        const result = await client.query(
          `INSERT INTO industrial_supplier_revisions(company_id,supplier_reference,revision,legal_name,trading_name,country_code,
             sector,supplier_tier,lifecycle_status,evidence_document_id,evidence_snapshot,metadata,profile_sha256,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14) RETURNING *`,
          [companyId, v.supplierReference, revision, v.legalName, v.tradingName, v.countryCode, v.sector, v.supplierTier,
            v.lifecycleStatus, evidence.id, JSON.stringify(snapshot), JSON.stringify(v.metadata), controls.sha(payload), userId]);
        return this._profile(result.rows[0]);
      } });
  }

  async listSites(companyId) {
    const result = await this.database.query(
      `SELECT s.*,p.supplier_reference,p.legal_name FROM industrial_supplier_site_revisions s
       JOIN industrial_supplier_revisions p ON p.id=s.supplier_revision_id AND p.company_id=s.company_id
       WHERE s.company_id=$1 ORDER BY s.created_at DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._site(row));
  }

  async createSite(companyId, userId, input) {
    const parsed = controls.site(input);
    if (parsed.errors.length) return blocked('SUPPLIER_SITE_INVALID', parsed.errors.join(' '));
    const [supplier, evidence] = await Promise.all([
      this.database.query('SELECT id FROM industrial_supplier_revisions WHERE id=$1 AND company_id=$2', [parsed.value.supplierRevisionId, companyId]),
      this._evidence(companyId, parsed.value.evidenceDocumentId)
    ]);
    if (!supplier.rows[0] || !evidence) return blocked('SUPPLIER_SITE_REFERENCE_INVALID', 'Tenant-bound supplier and locked location evidence are required.');
    const snapshot = evidenceSnapshot(evidence); const v = parsed.value;
    return this._revisionInsert({ companyId, lockKey: `supplier-site:${v.supplierRevisionId}`, revisionTable: 'industrial_supplier_site_revisions',
      referenceColumn: 'site_reference', referenceValue: v.siteReference, duplicateCode: 'SUPPLIER_SITE_DUPLICATE',
      insert: async (client, revision) => {
        const payload = { ...v, revision, evidenceSnapshot: snapshot };
        const result = await client.query(
          `INSERT INTO industrial_supplier_site_revisions(company_id,supplier_revision_id,site_reference,revision,site_name,
             country_code,latitude,longitude,precision_meters,location_basis,evidence_document_id,evidence_snapshot,site_sha256,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
          [companyId, v.supplierRevisionId, v.siteReference, revision, v.siteName, v.countryCode, v.latitude, v.longitude,
            v.precisionMeters, v.locationBasis, evidence.id, JSON.stringify(snapshot), controls.sha(payload), userId]);
        return this._site(result.rows[0]);
      } });
  }

  async listRelationships(companyId) {
    const result = await this.database.query(
      `SELECT r.*,p.supplier_reference,p.legal_name FROM industrial_supplier_relationship_revisions r
       JOIN industrial_supplier_revisions p ON p.id=r.supplier_revision_id AND p.company_id=r.company_id
       WHERE r.company_id=$1 ORDER BY r.created_at DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._relationship(row));
  }

  async createRelationship(companyId, userId, input) {
    const parsed = controls.relationship(input);
    if (parsed.errors.length) return blocked('SUPPLIER_RELATIONSHIP_INVALID', parsed.errors.join(' '));
    const [supplier, evidence] = await Promise.all([
      this.database.query('SELECT id FROM industrial_supplier_revisions WHERE id=$1 AND company_id=$2', [parsed.value.supplierRevisionId, companyId]),
      this._evidence(companyId, parsed.value.evidenceDocumentId)
    ]);
    if (!supplier.rows[0] || !evidence) return blocked('SUPPLIER_RELATIONSHIP_REFERENCE_INVALID', 'Tenant-bound supplier and locked procurement evidence are required.');
    const snapshot = evidenceSnapshot(evidence); const v = parsed.value;
    return this._revisionInsert({ companyId, lockKey: 'supplier-relationship', revisionTable: 'industrial_supplier_relationship_revisions',
      referenceColumn: 'relationship_reference', referenceValue: v.relationshipReference, duplicateCode: 'SUPPLIER_RELATIONSHIP_DUPLICATE',
      insert: async (client, revision) => {
        const payload = { ...v, revision, evidenceSnapshot: snapshot };
        const result = await client.query(
          `INSERT INTO industrial_supplier_relationship_revisions(company_id,supplier_revision_id,relationship_reference,revision,
             material_or_service,procurement_category,spend_percent,production_dependency_percent,single_source,
             dependent_sku_count,dependent_route_count,effective_from,effective_to,evidence_document_id,evidence_snapshot,
             relationship_sha256,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17) RETURNING *`,
          [companyId, v.supplierRevisionId, v.relationshipReference, revision, v.materialOrService, v.procurementCategory,
            v.spendPercent, v.productionDependencyPercent, v.singleSource, v.dependentSkuCount, v.dependentRouteCount,
            v.effectiveFrom, v.effectiveTo, evidence.id, JSON.stringify(snapshot), controls.sha(payload), userId]);
        return this._relationship(result.rows[0]);
      } });
  }

  async listSupplierClimate(companyId) {
    const result = await this.database.query(
      `SELECT a.*,p.supplier_reference,p.legal_name,s.site_reference,s.site_name FROM industrial_supplier_climate_assessments a
       JOIN industrial_supplier_revisions p ON p.id=a.supplier_revision_id AND p.company_id=a.company_id
       JOIN industrial_supplier_site_revisions s ON s.id=a.site_revision_id AND s.company_id=a.company_id
       WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._climate(row));
  }

  async createSupplierClimate(companyId, userId, input) {
    const parsed = controls.climateAssessment(input);
    if (parsed.errors.length) return blocked('SUPPLIER_CLIMATE_INVALID', parsed.errors.join(' '));
    const [site, evidence] = await Promise.all([
      this.database.query(
        `SELECT s.id FROM industrial_supplier_site_revisions s JOIN evidence_documents e
           ON e.id=s.evidence_document_id AND e.company_id=s.company_id
         WHERE s.id=$1 AND s.company_id=$2 AND s.supplier_revision_id=$3
           AND e.status IN ('locked','third_party_verified') AND e.checksum_sha256=s.evidence_snapshot->>'checksumSha256' AND e.file_size_bytes>0`,
        [parsed.value.siteRevisionId, companyId, parsed.value.supplierRevisionId]),
      this._evidence(companyId, parsed.value.evidenceDocumentId)
    ]);
    if (!site.rows[0] || !evidence) return blocked('SUPPLIER_CLIMATE_REFERENCE_INVALID', 'Evidence-backed supplier site and locked climate source evidence are required.');
    const v = parsed.value; const snapshot = evidenceSnapshot(evidence);
    const payload = { companyId, ...v, evidenceChecksum: evidence.checksum_sha256 };
    const result = await this.database.query(
      `INSERT INTO industrial_supplier_climate_assessments(company_id,supplier_revision_id,site_revision_id,hazard_type,
         scenario_kind,scenario_reference,horizon_start,horizon_end,source_kind,source_url,dataset_identifier,dataset_version,
         spatial_resolution,temporal_resolution,grid_reference,spatial_match_notes,model_name,scenario_name,hazard_metric,
         metric_value,metric_unit,uncertainty_notes,exposure_rating,vulnerability_rating,priority_band,rating_rationale,
         evidence_document_id,evidence_snapshot,input_sha256,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30)
       RETURNING *`,
      [companyId, v.supplierRevisionId, v.siteRevisionId, v.hazardType, v.scenarioKind, v.scenarioReference,
        v.horizonStart, v.horizonEnd, v.sourceKind, v.sourceUrl, v.datasetIdentifier, v.datasetVersion,
        v.spatialResolution, v.temporalResolution, v.gridReference, v.spatialMatchNotes, v.modelName, v.scenarioName,
        v.hazardMetric, v.metricValue, v.metricUnit, v.uncertaintyNotes, v.exposureRating, v.vulnerabilityRating,
        v.priorityBand, v.ratingRationale, evidence.id, JSON.stringify(snapshot), controls.sha(payload), userId]);
    return this._climate(result.rows[0]);
  }

  async listCarbonSnapshots(companyId) {
    const result = await this.database.query(
      `SELECT c.*,f.facility_reference,f.name AS facility_name,p.supplier_reference,p.legal_name
       FROM carbon_climate_subject_carbon_snapshots c
       LEFT JOIN industrial_facility_revisions f ON f.id=c.facility_revision_id AND f.company_id=c.company_id
       LEFT JOIN industrial_supplier_revisions p ON p.id=c.supplier_revision_id AND p.company_id=c.company_id
       WHERE c.company_id=$1 ORDER BY c.created_at DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._carbon(row));
  }

  async createCarbonSnapshot(companyId, userId, input) {
    const parsed = controls.carbonSnapshot(input);
    if (parsed.errors.length) return blocked('CRITICALITY_CARBON_INVALID', parsed.errors.join(' '));
    const v = parsed.value;
    const [subject, evidence] = await Promise.all([
      this.database.query(v.subjectKind === 'facility'
        ? 'SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2'
        : 'SELECT id FROM industrial_supplier_revisions WHERE id=$1 AND company_id=$2',
      [v.subjectKind === 'facility' ? v.facilityRevisionId : v.supplierRevisionId, companyId]),
      this._evidence(companyId, v.evidenceDocumentId)
    ]);
    if (!subject.rows[0] || !evidence) return blocked('CRITICALITY_CARBON_REFERENCE_INVALID', 'Tenant-bound subject and locked carbon evidence are required.');
    const snapshot = evidenceSnapshot(evidence); const payload = { companyId, ...v, evidenceSnapshot: snapshot };
    try {
      const result = await this.database.query(
        `INSERT INTO carbon_climate_subject_carbon_snapshots(company_id,subject_kind,facility_revision_id,supplier_revision_id,
           reporting_period_start,reporting_period_end,gross_kg_co2e,activity_quantity,activity_unit,intensity_kg_co2e,
           boundary,methodology_reference,source_kind,data_quality_level,evidence_document_id,evidence_snapshot,carbon_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18) RETURNING *`,
        [companyId, v.subjectKind, v.facilityRevisionId, v.supplierRevisionId, v.reportingPeriodStart, v.reportingPeriodEnd,
          v.grossKgCo2e, v.activityQuantity, v.activityUnit, v.intensityKgCo2e, v.boundary, v.methodologyReference,
          v.sourceKind, v.dataQualityLevel, evidence.id, JSON.stringify(snapshot), controls.sha(payload), userId]);
      return this._carbon(result.rows[0]);
    } catch (error) { if (error.code === '23505') return blocked('CRITICALITY_CARBON_DUPLICATE', 'Identical carbon basis already exists.', 409); throw error; }
  }

  async listModels(companyId) {
    const result = await this.database.query(
      'SELECT * FROM carbon_climate_criticality_model_revisions WHERE company_id=$1 ORDER BY model_reference,revision DESC LIMIT 200', [companyId]);
    return result.rows.map((row) => this._model(row));
  }

  async createModel(companyId, userId, input) {
    const parsed = controls.criticalityModel(input);
    if (parsed.errors.length) return blocked('CRITICALITY_MODEL_INVALID', parsed.errors.join(' '));
    const evidence = await this._evidence(companyId, parsed.value.evidenceDocumentId);
    if (!evidence) return blocked('CRITICALITY_MODEL_EVIDENCE_INVALID', 'Locked, checksummed methodology evidence is required.');
    const v = parsed.value; const snapshot = evidenceSnapshot(evidence);
    return this._revisionInsert({ companyId, lockKey: 'criticality-model', revisionTable: 'carbon_climate_criticality_model_revisions',
      referenceColumn: 'model_reference', referenceValue: v.modelReference, duplicateCode: 'CRITICALITY_MODEL_DUPLICATE',
      insert: async (client, revision) => {
        const payload = { ...v, revision, evidenceSnapshot: snapshot };
        const result = await client.query(
          `INSERT INTO carbon_climate_criticality_model_revisions(company_id,model_reference,revision,carbon_weight_percent,
             climate_weight_percent,dependency_weight_percent,medium_threshold,high_threshold,normalization_policy,rationale,
             approval_status,evidence_document_id,evidence_snapshot,model_sha256,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING *`,
          [companyId, v.modelReference, revision, v.carbonWeightPercent, v.climateWeightPercent, v.dependencyWeightPercent,
            v.mediumThreshold, v.highThreshold, v.normalizationPolicy, v.rationale, v.approvalStatus,
            evidence.id, JSON.stringify(snapshot), controls.sha(payload), userId]);
        return this._model(result.rows[0]);
      } });
  }

  async listCriticality(companyId) {
    const result = await this.database.query(
      `SELECT s.*,f.facility_reference,f.name AS facility_name,p.supplier_reference,p.legal_name,m.model_reference,m.revision AS model_revision
       FROM carbon_climate_criticality_snapshots s
       LEFT JOIN industrial_facility_revisions f ON f.id=s.facility_revision_id AND f.company_id=s.company_id
       LEFT JOIN industrial_supplier_revisions p ON p.id=s.supplier_revision_id AND p.company_id=s.company_id
       JOIN carbon_climate_criticality_model_revisions m ON m.id=s.model_revision_id AND m.company_id=s.company_id
       WHERE s.company_id=$1 ORDER BY s.created_at DESC LIMIT 500`, [companyId]);
    return result.rows.map((row) => this._criticality(row));
  }

  async createCriticality(companyId, userId, input) {
    const parsed = controls.criticality(input);
    if (parsed.errors.length) return blocked('CRITICALITY_SNAPSHOT_INVALID', parsed.errors.join(' '));
    const v = parsed.value; const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const modelResult = await client.query(
        `SELECT m.*,e.status AS evidence_status,e.checksum_sha256 AS evidence_checksum_sha256,e.file_size_bytes AS evidence_file_size_bytes
         FROM carbon_climate_criticality_model_revisions m JOIN evidence_documents e ON e.id=m.evidence_document_id AND e.company_id=m.company_id
         WHERE m.id=$1 AND m.company_id=$2`, [v.modelRevisionId, companyId]);
      const model = modelResult.rows[0];
      if (!model || model.approval_status !== 'approved' || !evidenceValid(model, 'evidence_') || model.evidence_checksum_sha256 !== model.evidence_snapshot?.checksumSha256) {
        await client.query('ROLLBACK'); return blocked('CRITICALITY_MODEL_NOT_APPROVED', 'An approved model with current locked evidence is required.');
      }
      const carbonResult = await client.query(
        `SELECT c.*,e.status AS evidence_status,e.checksum_sha256 AS evidence_checksum_sha256,e.file_size_bytes AS evidence_file_size_bytes
         FROM carbon_climate_subject_carbon_snapshots c JOIN evidence_documents e ON e.id=c.evidence_document_id AND e.company_id=c.company_id
         WHERE c.id=$1 AND c.company_id=$2`, [v.carbonSnapshotId, companyId]);
      const carbon = carbonResult.rows[0];
      const subjectId = v.subjectKind === 'facility' ? v.facilityRevisionId : v.supplierRevisionId;
      const carbonSubjectId = v.subjectKind === 'facility' ? carbon?.facility_revision_id : carbon?.supplier_revision_id;
      if (!carbon || carbon.subject_kind !== v.subjectKind || carbonSubjectId !== subjectId ||
          isoDate(carbon.reporting_period_start) > v.assessmentPeriodStart || isoDate(carbon.reporting_period_end) < v.assessmentPeriodEnd ||
          !evidenceValid(carbon, 'evidence_') || carbon.evidence_checksum_sha256 !== carbon.evidence_snapshot?.checksumSha256) {
        await client.query('ROLLBACK'); return blocked('CRITICALITY_CARBON_NOT_COMPARABLE', 'Carbon basis must match the subject, cover the assessment period and retain locked evidence.');
      }
      const subject = await this._criticalitySubject(client, companyId, v);
      if (subject.blocked) { await client.query('ROLLBACK'); return subject; }
      const climate = await this._criticalityClimate(client, companyId, v);
      if (climate.blocked) { await client.query('ROLLBACK'); return climate; }
      const weightedScore = Number(((v.normalizedCarbonScore * Number(model.carbon_weight_percent) +
        v.normalizedClimateScore * Number(model.climate_weight_percent) +
        v.normalizedDependencyScore * Number(model.dependency_weight_percent)) / 100).toFixed(4));
      const priorityBand = weightedScore >= Number(model.high_threshold) ? 'high' : weightedScore >= Number(model.medium_threshold) ? 'medium' : 'low';
      const inputSnapshot = { subjectKind: v.subjectKind, subjectId, subject: subject.snapshot,
        assessmentPeriodStart: v.assessmentPeriodStart,
        assessmentPeriodEnd: v.assessmentPeriodEnd, model: { id: model.id, reference: model.model_reference,
          revision: Number(model.revision), weights: { carbon: Number(model.carbon_weight_percent), climate: Number(model.climate_weight_percent),
            dependency: Number(model.dependency_weight_percent) }, thresholds: { medium: Number(model.medium_threshold), high: Number(model.high_threshold) },
          normalizationPolicy: model.normalization_policy, modelSha256: model.model_sha256 },
        carbon: { id: carbon.id, grossKgCo2e: Number(carbon.gross_kg_co2e), intensityKgCo2e: carbon.intensity_kg_co2e === null ? null : Number(carbon.intensity_kg_co2e),
          sourceKind: carbon.source_kind, dataQualityLevel: carbon.data_quality_level, carbonSha256: carbon.carbon_sha256 },
        dependencyBasis: v.subjectKind === 'facility'
          ? { source: 'facility_climate_assessments', businessDependencyPercent: Number(climate.rows[0].business_dependency_percent) }
          : subject.dependencyBasis,
        climateScope: climate.scope, climateAssessments: climate.snapshots,
        componentScores: { carbon: v.normalizedCarbonScore, climate: v.normalizedClimateScore, dependency: v.normalizedDependencyScore },
        scoreRationales: { carbon: v.carbonScoreRationale, climate: v.climateScoreRationale, dependency: v.dependencyScoreRationale },
        weightedScore, priorityBand, reviewStatus: 'needs_specialist_review' };
      const inputSha256 = controls.sha(inputSnapshot);
      const inserted = await client.query(
        `INSERT INTO carbon_climate_criticality_snapshots(company_id,subject_kind,facility_revision_id,supplier_revision_id,
           relationship_revision_id,carbon_snapshot_id,model_revision_id,assessment_period_start,assessment_period_end,
           normalized_carbon_score,normalized_climate_score,normalized_dependency_score,carbon_score_rationale,
           climate_score_rationale,dependency_score_rationale,weighted_score,priority_band,input_snapshot,input_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20) RETURNING *`,
        [companyId, v.subjectKind, v.facilityRevisionId, v.supplierRevisionId, v.relationshipRevisionId,
          v.carbonSnapshotId, v.modelRevisionId, v.assessmentPeriodStart, v.assessmentPeriodEnd,
          v.normalizedCarbonScore, v.normalizedClimateScore, v.normalizedDependencyScore, v.carbonScoreRationale,
          v.climateScoreRationale, v.dependencyScoreRationale, weightedScore, priorityBand,
          JSON.stringify(inputSnapshot), inputSha256, userId]);
      for (const assessment of climate.rows) await client.query(
        `INSERT INTO carbon_climate_criticality_climate_members(company_id,criticality_snapshot_id,
           facility_climate_assessment_id,supplier_climate_assessment_id,hazard_type)
         VALUES($1,$2,$3,$4,$5)`, [companyId, inserted.rows[0].id,
          v.subjectKind === 'facility' ? assessment.id : null, v.subjectKind === 'supplier' ? assessment.id : null, assessment.hazard_type]);
      await client.query('COMMIT'); return this._criticality(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return blocked('CRITICALITY_SNAPSHOT_DUPLICATE', 'Identical criticality snapshot already exists.', 409);
      throw error;
    } finally { client.release(); }
  }

  async _criticalitySubject(client, companyId, v) {
    if (v.subjectKind === 'facility') {
      const result = await client.query('SELECT id,facility_reference,name FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [v.facilityRevisionId, companyId]);
      return result.rows[0] ? { snapshot: { kind: 'facility', id: result.rows[0].id,
        facilityReference: result.rows[0].facility_reference, name: result.rows[0].name },
        dependencyBasis: { source: 'facility_climate_assessments', businessDependencyPercent: null } }
        : blocked('CRITICALITY_SUBJECT_INVALID', 'Facility subject not found.');
    }
    const result = await client.query(
      `SELECT p.id,p.supplier_reference,p.legal_name,p.profile_sha256,r.id AS relationship_id,r.relationship_sha256,
              r.spend_percent,r.production_dependency_percent,
              r.single_source,r.dependent_sku_count,r.dependent_route_count,r.effective_from,r.effective_to,
              p.evidence_snapshot AS profile_evidence_snapshot,r.evidence_snapshot AS relationship_evidence_snapshot,
              pe.status AS profile_evidence_status,pe.checksum_sha256 AS profile_evidence_checksum_sha256,pe.file_size_bytes AS profile_evidence_file_size_bytes,
              re.status AS relationship_evidence_status,re.checksum_sha256 AS relationship_evidence_checksum_sha256,re.file_size_bytes AS relationship_evidence_file_size_bytes
       FROM industrial_supplier_revisions p JOIN evidence_documents pe ON pe.id=p.evidence_document_id AND pe.company_id=p.company_id
       JOIN industrial_supplier_relationship_revisions r ON r.supplier_revision_id=p.id AND r.company_id=p.company_id
       JOIN evidence_documents re ON re.id=r.evidence_document_id AND re.company_id=r.company_id
       WHERE p.id=$1 AND p.company_id=$2 AND r.id=$3`, [v.supplierRevisionId, companyId, v.relationshipRevisionId]);
    const row = result.rows[0];
    if (!row || !evidenceValid(row, 'profile_evidence_') || row.profile_evidence_checksum_sha256 !== row.profile_evidence_snapshot?.checksumSha256 ||
        !evidenceValid(row, 'relationship_evidence_') || row.relationship_evidence_checksum_sha256 !== row.relationship_evidence_snapshot?.checksumSha256 ||
        isoDate(row.effective_from) > v.assessmentPeriodEnd || (row.effective_to && isoDate(row.effective_to) < v.assessmentPeriodStart)) {
      return blocked('CRITICALITY_SUPPLIER_DEPENDENCY_INVALID', 'Supplier profile and an effective, evidence-backed dependency relationship are required.');
    }
    return { snapshot: { kind: 'supplier', id: row.id, supplierReference: row.supplier_reference,
      legalName: row.legal_name, profileSha256: row.profile_sha256 },
      dependencyBasis: { source: 'supplier_relationship', relationshipRevisionId: row.relationship_id,
      relationshipSha256: row.relationship_sha256,
      spendPercent: Number(row.spend_percent), productionDependencyPercent: Number(row.production_dependency_percent),
      singleSource: row.single_source, dependentSkuCount: row.dependent_sku_count, dependentRouteCount: row.dependent_route_count } };
  }

  async _criticalityClimate(client, companyId, v) {
    const query = v.subjectKind === 'facility'
      ? `SELECT a.*,e.status AS evidence_status,e.checksum_sha256 AS evidence_checksum_sha256,e.file_size_bytes AS evidence_file_size_bytes,
                le.status AS location_evidence_status,le.checksum_sha256 AS location_evidence_checksum_sha256,le.file_size_bytes AS location_evidence_file_size_bytes,
                l.evidence_snapshot AS location_evidence_snapshot
         FROM climate_risk_assessments a JOIN evidence_documents e ON e.id=a.evidence_document_id AND e.company_id=a.company_id
         JOIN climate_risk_location_revisions l ON l.id=a.location_revision_id AND l.company_id=a.company_id
         JOIN evidence_documents le ON le.id=l.evidence_document_id AND le.company_id=l.company_id
         WHERE a.company_id=$1 AND a.facility_revision_id=$2 AND a.id=ANY($3::uuid[])`
      : `SELECT a.*,e.status AS evidence_status,e.checksum_sha256 AS evidence_checksum_sha256,e.file_size_bytes AS evidence_file_size_bytes,
                se.status AS site_evidence_status,se.checksum_sha256 AS site_evidence_checksum_sha256,se.file_size_bytes AS site_evidence_file_size_bytes,
                s.evidence_snapshot AS site_evidence_snapshot
         FROM industrial_supplier_climate_assessments a JOIN evidence_documents e ON e.id=a.evidence_document_id AND e.company_id=a.company_id
         JOIN industrial_supplier_site_revisions s ON s.id=a.site_revision_id AND s.company_id=a.company_id
         JOIN evidence_documents se ON se.id=s.evidence_document_id AND se.company_id=s.company_id
         WHERE a.company_id=$1 AND a.supplier_revision_id=$2 AND a.id=ANY($3::uuid[])`;
    const result = await client.query(query, [companyId, v.subjectKind === 'facility' ? v.facilityRevisionId : v.supplierRevisionId, v.climateAssessmentIds]);
    const rows = result.rows;
    const first = rows[0]; const hazards = new Set(rows.map((row) => row.hazard_type));
    const evidenceOk = rows.every((row) => evidenceValid(row, 'evidence_') && row.evidence_checksum_sha256 === row.evidence_snapshot?.checksumSha256 &&
      (v.subjectKind === 'facility'
        ? evidenceValid(row, 'location_evidence_') && row.location_evidence_checksum_sha256 === row.location_evidence_snapshot?.checksumSha256
        : evidenceValid(row, 'site_evidence_') && row.site_evidence_checksum_sha256 === row.site_evidence_snapshot?.checksumSha256));
    const sameScenario = first && rows.every((row) => row.scenario_kind === first.scenario_kind && row.scenario_reference === first.scenario_reference &&
      row.source_kind === first.source_kind && isoDate(row.horizon_start) === isoDate(first.horizon_start) && isoDate(row.horizon_end) === isoDate(first.horizon_end) &&
      (row.scenario_kind !== 'projection' || (row.model_name === first.model_name && row.scenario_name === first.scenario_name)));
    if (rows.length !== v.climateAssessmentIds.length || hazards.size !== rows.length || !evidenceOk || !sameScenario) {
      return blocked('CRITICALITY_CLIMATE_NOT_COMPARABLE', 'Climate inputs must be unique hazards for the subject, share one scenario/horizon and retain locked evidence.');
    }
    if (v.subjectKind === 'facility') {
      const dependencies = new Set(rows.map((row) => Number(row.business_dependency_percent)));
      if (dependencies.size !== 1) return blocked('CRITICALITY_FACILITY_DEPENDENCY_CONFLICT', 'Facility climate inputs must share one business-dependency percentage.');
    }
    return { rows, scope: { scenarioKind: first.scenario_kind, scenarioReference: first.scenario_reference,
      horizonStart: isoDate(first.horizon_start), horizonEnd: isoDate(first.horizon_end), sourceKind: first.source_kind,
      modelName: first.model_name || null, scenarioName: first.scenario_name || null },
      snapshots: rows.map((row) => ({ id: row.id, hazardType: row.hazard_type, scenarioKind: row.scenario_kind,
      scenarioReference: row.scenario_reference, horizonStart: isoDate(row.horizon_start), horizonEnd: isoDate(row.horizon_end),
      sourceKind: row.source_kind, datasetIdentifier: row.dataset_identifier, datasetVersion: row.dataset_version,
      spatialResolution: row.spatial_resolution, temporalResolution: row.temporal_resolution, gridReference: row.grid_reference,
      modelName: row.model_name || null, scenarioName: row.scenario_name || null,
      exposureRating: row.exposure_rating, vulnerabilityRating: row.vulnerability_rating, priorityBand: row.priority_band,
      businessDependencyPercent: row.business_dependency_percent === undefined ? undefined : Number(row.business_dependency_percent), inputSha256: row.input_sha256 })) };
  }

  async listPortfolios(companyId) {
    const result = await this.database.query(
      'SELECT * FROM carbon_climate_criticality_portfolio_snapshots WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200', [companyId]);
    return result.rows.map((row) => this._portfolio(row));
  }

  async getPortfolio(companyId, portfolioId) {
    if (!UUID.test(portfolioId)) return null;
    const portfolio = await this.database.query('SELECT * FROM carbon_climate_criticality_portfolio_snapshots WHERE id=$1 AND company_id=$2', [portfolioId, companyId]);
    if (!portfolio.rows[0]) return null;
    const members = await this.database.query(
      `SELECT s.*,f.facility_reference,f.name AS facility_name,p.supplier_reference,p.legal_name
       FROM carbon_climate_criticality_portfolio_members pm JOIN carbon_climate_criticality_snapshots s
         ON s.id=pm.criticality_snapshot_id AND s.company_id=pm.company_id
       LEFT JOIN industrial_facility_revisions f ON f.id=s.facility_revision_id AND f.company_id=s.company_id
       LEFT JOIN industrial_supplier_revisions p ON p.id=s.supplier_revision_id AND p.company_id=s.company_id
       WHERE pm.portfolio_id=$1 AND pm.company_id=$2 ORDER BY s.weighted_score DESC`, [portfolioId, companyId]);
    return { ...this._portfolio(portfolio.rows[0]), members: members.rows.map((row) => this._criticality(row)) };
  }

  async createPortfolio(companyId, userId, input) {
    const parsed = controls.portfolio(input);
    if (parsed.errors.length) return blocked('CRITICALITY_PORTFOLIO_INVALID', parsed.errors.join(' '));
    const v = parsed.value; const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT s.*,c.source_kind AS carbon_source_kind,r.spend_percent,r.single_source,
                (SELECT COUNT(*) FROM carbon_climate_criticality_climate_members cm WHERE cm.criticality_snapshot_id=s.id) AS hazard_count
         FROM carbon_climate_criticality_snapshots s
         JOIN carbon_climate_subject_carbon_snapshots c ON c.id=s.carbon_snapshot_id AND c.company_id=s.company_id
         LEFT JOIN industrial_supplier_relationship_revisions r ON r.id=s.relationship_revision_id AND r.company_id=s.company_id
         WHERE s.company_id=$1 AND s.id=ANY($2::uuid[])`, [companyId, v.criticalitySnapshotIds]);
      const rows = result.rows; const first = rows[0];
      const subjectKeys = new Set(rows.map((row) => `${row.subject_kind}:${row.facility_revision_id || row.supplier_revision_id}`));
      const firstClimateScope = first?.input_snapshot?.climateScope;
      const comparable = first && firstClimateScope && rows.every((row) => row.model_revision_id === first.model_revision_id &&
        isoDate(row.assessment_period_start) === isoDate(first.assessment_period_start) && isoDate(row.assessment_period_end) === isoDate(first.assessment_period_end) &&
        controls.stableJson(row.input_snapshot?.climateScope) === controls.stableJson(firstClimateScope));
      if (rows.length !== v.criticalitySnapshotIds.length || subjectKeys.size !== rows.length || !comparable) {
        await client.query('ROLLBACK'); return blocked('CRITICALITY_PORTFOLIO_NOT_COMPARABLE', 'Portfolio inputs require unique subjects, one approved model, assessment period and climate scenario/horizon.');
      }
      const prioritySummary = { countByPriority: { low: 0, medium: 0, high: 0 }, averageWeightedScore: 0,
        reviewStatus: 'needs_specialist_review' };
      for (const row of rows) prioritySummary.countByPriority[row.priority_band] += 1;
      prioritySummary.averageWeightedScore = Number((rows.reduce((sum, row) => sum + Number(row.weighted_score), 0) / rows.length).toFixed(4));
      const suppliers = rows.filter((row) => row.subject_kind === 'supplier');
      const facilities = rows.filter((row) => row.subject_kind === 'facility');
      const coverageSummary = { method: 'selected_immutable_criticality_snapshots', subjectCount: rows.length,
        facilityCount: facilities.length, supplierCount: suppliers.length,
        supplierSpecificCarbonCount: suppliers.filter((row) => row.carbon_source_kind === 'supplier_specific').length,
        completeThreeHazardCount: rows.filter((row) => Number(row.hazard_count) === 3).length,
        supplierDependencyRecordCount: suppliers.filter((row) => row.relationship_revision_id).length,
        singleSourceSupplierCount: suppliers.filter((row) => row.single_source).length,
        selectedSupplierSpendPercent: Number(suppliers.reduce((sum, row) => sum + Number(row.spend_percent || 0), 0).toFixed(3)) };
      const inputSha256 = controls.sha({ companyId, portfolioReference: v.portfolioReference,
        criticalitySnapshotIds: [...v.criticalitySnapshotIds].sort(), methodologyNotes: v.methodologyNotes });
      const inserted = await client.query(
        `INSERT INTO carbon_climate_criticality_portfolio_snapshots(company_id,portfolio_reference,model_revision_id,
           assessment_period_start,assessment_period_end,subject_count,priority_summary,coverage_summary,methodology_notes,input_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11) RETURNING *`,
        [companyId, v.portfolioReference, first.model_revision_id, first.assessment_period_start, first.assessment_period_end,
          rows.length, JSON.stringify(prioritySummary), JSON.stringify(coverageSummary), v.methodologyNotes, inputSha256, userId]);
      for (const row of rows) await client.query(
        `INSERT INTO carbon_climate_criticality_portfolio_members(company_id,portfolio_id,criticality_snapshot_id,
           subject_kind,facility_revision_id,supplier_revision_id) VALUES($1,$2,$3,$4,$5,$6)`,
        [companyId, inserted.rows[0].id, row.id, row.subject_kind, row.facility_revision_id, row.supplier_revision_id]);
      await client.query('COMMIT'); return this._portfolio(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return blocked('CRITICALITY_PORTFOLIO_DUPLICATE', 'Identical portfolio snapshot already exists.', 409);
      throw error;
    } finally { client.release(); }
  }

  _profile(row) { return { id: row.id, supplierReference: row.supplier_reference, revision: Number(row.revision), legalName: row.legal_name,
    tradingName: row.trading_name, countryCode: row.country_code, sector: row.sector, supplierTier: row.supplier_tier,
    lifecycleStatus: row.lifecycle_status, evidenceSnapshot: row.evidence_snapshot, metadata: row.metadata,
    profileSha256: row.profile_sha256, createdAt: row.created_at }; }
  _site(row) { return { id: row.id, supplierRevisionId: row.supplier_revision_id, supplierReference: row.supplier_reference,
    supplierName: row.legal_name, siteReference: row.site_reference, revision: Number(row.revision), siteName: row.site_name,
    countryCode: row.country_code, latitude: Number(row.latitude), longitude: Number(row.longitude), precisionMeters: row.precision_meters,
    locationBasis: row.location_basis, evidenceSnapshot: row.evidence_snapshot, siteSha256: row.site_sha256, createdAt: row.created_at }; }
  _relationship(row) { return { id: row.id, supplierRevisionId: row.supplier_revision_id, supplierReference: row.supplier_reference,
    supplierName: row.legal_name, relationshipReference: row.relationship_reference, revision: Number(row.revision),
    materialOrService: row.material_or_service, procurementCategory: row.procurement_category, spendPercent: Number(row.spend_percent),
    productionDependencyPercent: Number(row.production_dependency_percent), singleSource: row.single_source,
    dependentSkuCount: row.dependent_sku_count, dependentRouteCount: row.dependent_route_count,
    effectiveFrom: isoDate(row.effective_from), effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    relationshipSha256: row.relationship_sha256, createdAt: row.created_at }; }
  _climate(row) { return { id: row.id, supplierRevisionId: row.supplier_revision_id, supplierReference: row.supplier_reference,
    supplierName: row.legal_name, siteRevisionId: row.site_revision_id, siteReference: row.site_reference, siteName: row.site_name,
    hazardType: row.hazard_type, scenarioKind: row.scenario_kind, scenarioReference: row.scenario_reference,
    horizonStart: isoDate(row.horizon_start), horizonEnd: isoDate(row.horizon_end), sourceKind: row.source_kind, sourceUrl: row.source_url,
    datasetIdentifier: row.dataset_identifier, datasetVersion: row.dataset_version, spatialResolution: row.spatial_resolution,
    temporalResolution: row.temporal_resolution, gridReference: row.grid_reference, spatialMatchNotes: row.spatial_match_notes,
    modelName: row.model_name, scenarioName: row.scenario_name, hazardMetric: row.hazard_metric, metricValue: Number(row.metric_value),
    metricUnit: row.metric_unit, uncertaintyNotes: row.uncertainty_notes, exposureRating: row.exposure_rating,
    vulnerabilityRating: row.vulnerability_rating, priorityBand: row.priority_band, ratingRationale: row.rating_rationale,
    screeningStatus: row.screening_status, evidenceSnapshot: row.evidence_snapshot, inputSha256: row.input_sha256, createdAt: row.created_at }; }
  _carbon(row) { return { id: row.id, subjectKind: row.subject_kind, facilityRevisionId: row.facility_revision_id,
    facilityReference: row.facility_reference, facilityName: row.facility_name, supplierRevisionId: row.supplier_revision_id,
    supplierReference: row.supplier_reference, supplierName: row.legal_name, reportingPeriodStart: isoDate(row.reporting_period_start),
    reportingPeriodEnd: isoDate(row.reporting_period_end), grossKgCo2e: Number(row.gross_kg_co2e),
    activityQuantity: row.activity_quantity === null ? null : Number(row.activity_quantity), activityUnit: row.activity_unit,
    intensityKgCo2e: row.intensity_kg_co2e === null ? null : Number(row.intensity_kg_co2e), boundary: row.boundary,
    methodologyReference: row.methodology_reference, sourceKind: row.source_kind, dataQualityLevel: row.data_quality_level,
    evidenceSnapshot: row.evidence_snapshot, carbonSha256: row.carbon_sha256, createdAt: row.created_at }; }
  _model(row) { return { id: row.id, modelReference: row.model_reference, revision: Number(row.revision),
    carbonWeightPercent: Number(row.carbon_weight_percent), climateWeightPercent: Number(row.climate_weight_percent),
    dependencyWeightPercent: Number(row.dependency_weight_percent), mediumThreshold: Number(row.medium_threshold),
    highThreshold: Number(row.high_threshold), normalizationPolicy: row.normalization_policy, rationale: row.rationale,
    approvalStatus: row.approval_status, evidenceSnapshot: row.evidence_snapshot, modelSha256: row.model_sha256, createdAt: row.created_at }; }
  _criticality(row) { return { id: row.id, subjectKind: row.subject_kind, facilityRevisionId: row.facility_revision_id,
    facilityReference: row.facility_reference, facilityName: row.facility_name, supplierRevisionId: row.supplier_revision_id,
    supplierReference: row.supplier_reference, supplierName: row.legal_name, relationshipRevisionId: row.relationship_revision_id,
    carbonSnapshotId: row.carbon_snapshot_id, modelRevisionId: row.model_revision_id, modelReference: row.model_reference,
    modelRevision: row.model_revision === undefined ? undefined : Number(row.model_revision), assessmentPeriodStart: isoDate(row.assessment_period_start),
    assessmentPeriodEnd: isoDate(row.assessment_period_end), normalizedCarbonScore: Number(row.normalized_carbon_score),
    normalizedClimateScore: Number(row.normalized_climate_score), normalizedDependencyScore: Number(row.normalized_dependency_score),
    weightedScore: Number(row.weighted_score), priorityBand: row.priority_band, reviewStatus: row.review_status,
    inputSnapshot: row.input_snapshot, inputSha256: row.input_sha256, createdAt: row.created_at }; }
  _portfolio(row) { return { id: row.id, portfolioReference: row.portfolio_reference, modelRevisionId: row.model_revision_id,
    assessmentPeriodStart: isoDate(row.assessment_period_start), assessmentPeriodEnd: isoDate(row.assessment_period_end),
    subjectCount: row.subject_count, prioritySummary: row.priority_summary, coverageSummary: row.coverage_summary,
    methodologyNotes: row.methodology_notes, inputSha256: row.input_sha256, createdAt: row.created_at }; }
}

module.exports = { SupplierNetworkService, supplierNetworkService: new SupplierNetworkService() };
