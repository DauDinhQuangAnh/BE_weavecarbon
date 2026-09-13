const pool = require('../config/database');
const { RULESET, normalizeCorporateGhgInput, evaluateCorporateGhgInventory, deriveCorporateGhgStatus } = require('./corporateGhgInventoryControls');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function dateOnly(value) { if (!value) return null; return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }

class CorporateGhgInventoryService {
  constructor(database = pool) { this.database = database; }

  async _companyExists(companyId) {
    const result = await this.database.query('SELECT id, name FROM companies WHERE id=$1', [companyId]);
    return result.rows[0] || null;
  }

  async _loadEvidence(companyId, evidenceIds) {
    if (!evidenceIds.length) return [];
    const result = await this.database.query(
      `SELECT id, evidence_type, document_name, checksum_sha256, file_size_bytes, status,
              reporting_period_start, reporting_period_end
       FROM evidence_documents WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [companyId, evidenceIds]
    );
    return result.rows.map((row) => ({ id: row.id, type: row.evidence_type, name: row.document_name,
      checksumSha256: row.checksum_sha256, fileSizeBytes: Number(row.file_size_bytes || 0), status: row.status,
      reportingPeriodStart: dateOnly(row.reporting_period_start), reportingPeriodEnd: dateOnly(row.reporting_period_end) }));
  }

  async _loadInvoiceActivity(companyId, normalized) {
    const startMonth = normalized.reportingPeriodStart?.slice(0, 7); const endMonth = normalized.reportingPeriodEnd?.slice(0, 7);
    if (!startMonth || !endMonth) return [];
    const [electricity, fuels] = await Promise.all([
      this.database.query(
        `SELECT id, facility_name, billing_period, kwh, emission_factor_kg_per_kwh,
                emission_factor_source, scope2_co2e_kg, status, evidence_document_id
         FROM electricity_invoices WHERE company_id=$1 AND billing_period ~ '^\\d{4}-\\d{2}$'
           AND billing_period >= $2 AND billing_period <= $3 ORDER BY billing_period, id`, [companyId, startMonth, endMonth]),
      this.database.query(
        `SELECT id, billing_period, fuel_type, quantity_liters, emission_factor_kg_per_liter,
                scope1_co2e_kg, status, evidence_document_id
         FROM fuel_invoices WHERE company_id=$1 AND billing_period ~ '^\\d{4}-\\d{2}$'
           AND billing_period >= $2 AND billing_period <= $3 ORDER BY billing_period, id`, [companyId, startMonth, endMonth])
    ]);
    const facilitiesByName = new Map(normalized.facilities.map((item) => [item.name.toLowerCase(), item.reference]));
    const electricityRows = electricity.rows.map((row) => ({ sourceType: 'electricity_invoice', sourceReference: row.id,
      facilityReference: facilitiesByName.get(text(row.facility_name).toLowerCase()) || '', scope: 'scope2', category: 'purchased_electricity',
      gas: 'CO2e', accountingMethod: 'location_based', activityValue: Number(row.kwh), activityUnit: 'kWh',
      emissionFactor: Number(row.emission_factor_kg_per_kwh), factorUnit: 'kg CO2e/kWh', factorSource: text(row.emission_factor_source),
      factorVersion: normalized.scope2Accounting.locationBasedFactorVersion, gwpBasis: normalized.scope2Accounting.gwpBasis,
      calculatedCo2eKg: Number(row.scope2_co2e_kg), reportedCo2eKg: Number(row.scope2_co2e_kg), recordStatus: row.status,
      billingPeriod: row.billing_period, evidenceDocumentId: row.evidence_document_id,
      evidenceDocumentIds: row.evidence_document_id ? [row.evidence_document_id] : [] }));
    const fuelRows = fuels.rows.map((row) => {
      const metadata = normalized.fuelFactorMetadata.find((item) => item.fuelType === row.fuel_type) || {};
      return { sourceType: 'fuel_invoice', sourceReference: row.id, facilityReference: normalized.defaultFuelFacilityReference,
        scope: 'scope1', category: 'stationary_combustion', gas: 'CO2e', accountingMethod: 'location_based',
        activityValue: Number(row.quantity_liters), activityUnit: 'L', emissionFactor: Number(row.emission_factor_kg_per_liter),
        factorUnit: 'kg CO2e/L', factorSource: metadata.source || '', factorVersion: metadata.version || '', gwpBasis: metadata.gwpBasis || '',
        calculatedCo2eKg: Number(row.scope1_co2e_kg), reportedCo2eKg: Number(row.scope1_co2e_kg), recordStatus: row.status,
        fuelType: row.fuel_type, billingPeriod: row.billing_period, evidenceDocumentId: row.evidence_document_id,
        evidenceDocumentIds: row.evidence_document_id ? [row.evidence_document_id] : [] };
    });
    return [...electricityRows, ...fuelRows];
  }

  async createRevision(companyId, userId, input = {}) {
    const company = await this._companyExists(companyId); if (!company) return null;
    const normalized = normalizeCorporateGhgInput(input);
    if (!normalized.inventoryReference || !normalized.inventoryDate) {
      return { blocked: true, code: 'GHG_INVENTORY_IDENTITY_REQUIRED', message: 'inventoryReference and inventoryDate are required.' };
    }
    const invoiceActivity = await this._loadInvoiceActivity(companyId, normalized);
    const evidenceIds = new Set(normalized.evidenceDocumentIds);
    normalized.facilities.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
    normalized.additionalSources.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
    normalized.scope2Accounting.contractualInstrumentEvidenceIds.forEach((id) => evidenceIds.add(id));
    invoiceActivity.forEach((item) => item.evidenceDocumentIds.forEach((id) => evidenceIds.add(id)));
    if (normalized.assurance.evidenceDocumentId) evidenceIds.add(normalized.assurance.evidenceDocumentId);
    const ids = [...evidenceIds].filter(Boolean).sort();
    if (ids.length > 500 || ids.some((id) => !UUID_REGEX.test(id))) {
      return { blocked: true, code: 'GHG_EVIDENCE_INVALID', message: 'Inventory evidence must contain at most 500 valid UUIDs.' };
    }
    const evidenceSnapshot = await this._loadEvidence(companyId, ids);
    if (evidenceSnapshot.length !== ids.length) {
      return { blocked: true, code: 'GHG_EVIDENCE_INVALID', message: 'Every inventory evidence id must belong to the active company.' };
    }
    const evaluation = evaluateCorporateGhgInventory(input, invoiceActivity, evidenceSnapshot);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${companyId}:corporate-ghg:${evaluation.input.inventoryReference}`]);
      const version = await client.query(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision FROM corporate_ghg_inventory_revisions
         WHERE company_id=$1 AND inventory_reference=$2`, [companyId, evaluation.input.inventoryReference]);
      const inserted = await client.query(
        `INSERT INTO corporate_ghg_inventory_revisions (
           company_id, inventory_reference, revision, ruleset_id, ruleset_version, ruleset_coverage,
           source_manifest_sha256, inventory_date, reporting_period_start, reporting_period_end,
           input_snapshot, input_sha256, activity_snapshot, activity_snapshot_sha256,
           result_snapshot, result_sha256, evidence_snapshot, automated_status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15::jsonb,$16,$17::jsonb,$18,$19)
         RETURNING *`, [companyId, evaluation.input.inventoryReference, Number(version.rows[0].revision), RULESET.id, RULESET.version,
          RULESET.coverageStatus, evaluation.result.sourceManifestSha256, evaluation.input.inventoryDate,
          evaluation.input.reportingPeriodStart, evaluation.input.reportingPeriodEnd, JSON.stringify(evaluation.input), evaluation.inputSha256,
          JSON.stringify(evaluation.activitySnapshot), evaluation.activitySnapshotSha256, JSON.stringify(evaluation.result),
          evaluation.result.resultSha256, JSON.stringify(evidenceSnapshot), evaluation.result.automatedStatus, userId]);
      await client.query('COMMIT'); return this._formatInventory(inserted.rows[0], evidenceSnapshot);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async list(companyId) {
    if (!(await this._companyExists(companyId))) return null;
    const result = await this.database.query(
      `SELECT inventory.*, to_jsonb(latest_review) AS latest_review,
              MAX(inventory.revision) OVER (PARTITION BY inventory.inventory_reference) AS latest_revision
       FROM corporate_ghg_inventory_revisions inventory
       LEFT JOIN LATERAL (SELECT review.* FROM corporate_ghg_inventory_reviews review
         WHERE review.inventory_id=inventory.id AND review.company_id=inventory.company_id
         ORDER BY review.created_at DESC, review.id DESC LIMIT 1) latest_review ON true
       WHERE inventory.company_id=$1 ORDER BY inventory.created_at DESC, inventory.id DESC`, [companyId]);
    const evidenceIds = [...new Set(result.rows.flatMap((row) => array(row.evidence_snapshot).map((item) => item.id)))];
    const currentEvidence = await this._loadEvidence(companyId, evidenceIds);
    return result.rows.map((row) => this._formatInventory(row, currentEvidence));
  }

  async review(companyId, inventoryId, userId, input = {}) {
    if (!UUID_REGEX.test(text(inventoryId))) return null;
    const role = text(input.reviewerRole || input.reviewer_role); const decision = text(input.decision).toLowerCase(); const notes = text(input.notes);
    if (role !== 'corporate_ghg_inventory_reviewer') return { blocked: true, code: 'GHG_REVIEW_ROLE_INVALID', message: 'Corporate inventories require the corporate_ghg_inventory_reviewer role.' };
    if (!['approved_for_internal_report', 'needs_information', 'rejected'].includes(decision) || !notes) {
      return { blocked: true, code: 'GHG_REVIEW_INVALID', message: 'A supported decision and review notes are required.' };
    }
    const found = await this.database.query(
      `SELECT inventory.*, (SELECT MAX(candidate.revision) FROM corporate_ghg_inventory_revisions candidate
         WHERE candidate.company_id=inventory.company_id AND candidate.inventory_reference=inventory.inventory_reference) AS latest_revision
       FROM corporate_ghg_inventory_revisions inventory WHERE inventory.id=$1 AND inventory.company_id=$2`, [inventoryId, companyId]);
    const inventory = found.rows[0]; if (!inventory) return null;
    if (decision === 'approved_for_internal_report' && (inventory.automated_status !== 'inventory_review_required'
      || Number(inventory.latest_revision) !== Number(inventory.revision))) {
      return { blocked: true, code: 'GHG_INVENTORY_NOT_CURRENT', message: 'Only the latest passing inventory revision can be approved.' };
    }
    const evidenceSnapshot = await this._loadEvidence(companyId, array(inventory.evidence_snapshot).map((item) => item.id));
    if (decision === 'approved_for_internal_report') {
      const derived = deriveCorporateGhgStatus({ result_snapshot: inventory.result_snapshot,
        latest_review: { decision, evidence_snapshot: inventory.evidence_snapshot } }, evidenceSnapshot);
      if (derived.status !== 'approved_for_internal_report' || !evidenceSnapshot.length) {
        return { blocked: true, code: 'GHG_EVIDENCE_STALE', message: 'Approval requires all evidence to remain locked and checksum-identical.' };
      }
    }
    const reviewerResult = await this.database.query('SELECT id, email, full_name FROM users WHERE id=$1', [userId]);
    const reviewer = reviewerResult.rows[0]; if (!reviewer || !text(reviewer.full_name || reviewer.email)) {
      return { blocked: true, code: 'GHG_REVIEWER_NOT_FOUND', message: 'Named inventory reviewer identity is required.' };
    }
    const inserted = await this.database.query(
      `INSERT INTO corporate_ghg_inventory_reviews (company_id, inventory_id, reviewer_id, reviewer_name_snapshot,
         reviewer_email_snapshot, reviewer_role, decision, notes, input_sha256, activity_snapshot_sha256,
         result_sha256, evidence_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *`,
      [companyId, inventoryId, userId, reviewer.full_name || reviewer.email, reviewer.email || null, role, decision, notes,
        inventory.input_sha256, inventory.activity_snapshot_sha256, inventory.result_sha256, JSON.stringify(evidenceSnapshot)]);
    return this._formatReview(inserted.rows[0]);
  }

  _formatInventory(row, currentEvidence = []) {
    const latestReview = row.latest_review ? this._formatReview(row.latest_review) : null;
    const derived = Number(row.latest_revision || row.revision) !== Number(row.revision)
      ? { status: 'superseded', staleEvidenceIds: [] } : deriveCorporateGhgStatus({ result_snapshot: row.result_snapshot, latest_review: latestReview }, currentEvidence);
    return { id: row.id, inventoryReference: row.inventory_reference, revision: Number(row.revision), rulesetId: row.ruleset_id,
      rulesetVersion: row.ruleset_version, rulesetCoverage: row.ruleset_coverage, sourceManifestSha256: row.source_manifest_sha256,
      inventoryDate: dateOnly(row.inventory_date), reportingPeriodStart: dateOnly(row.reporting_period_start),
      reportingPeriodEnd: dateOnly(row.reporting_period_end), input: row.input_snapshot, inputSha256: row.input_sha256,
      activitySnapshot: row.activity_snapshot, activitySnapshotSha256: row.activity_snapshot_sha256,
      result: row.result_snapshot, resultSha256: row.result_sha256, evidenceSnapshot: row.evidence_snapshot,
      automatedStatus: row.automated_status, inventoryStatus: derived.status, staleEvidenceIds: derived.staleEvidenceIds,
      createdBy: row.created_by, createdAt: row.created_at, latestReview };
  }

  _formatReview(row) {
    return { id: row.id, inventoryId: row.inventory_id, reviewerId: row.reviewer_id,
      reviewerName: row.reviewer_name_snapshot, reviewerEmail: row.reviewer_email_snapshot,
      reviewerRole: row.reviewer_role, decision: row.decision, notes: row.notes, inputSha256: row.input_sha256,
      activitySnapshotSha256: row.activity_snapshot_sha256, resultSha256: row.result_sha256,
      evidenceSnapshot: row.evidence_snapshot, createdAt: row.created_at };
  }
}

module.exports = { CorporateGhgInventoryService, corporateGhgInventoryService: new CorporateGhgInventoryService(), RULESET };
