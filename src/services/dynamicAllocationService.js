const pool = require('../config/database');
const controls = require('./dynamicAllocationControls');

const CONTROLLED_EVIDENCE = new Set(['locked', 'third_party_verified']);

class DynamicAllocationService {
  constructor(database = pool) { this.database = database; }

  async listRules(companyId) {
    const result = await this.database.query(
      `SELECT rule.*, facility.facility_reference, facility.name AS facility_name
       FROM industrial_allocation_rule_revisions rule
       JOIN industrial_facility_revisions facility
         ON facility.id=rule.facility_revision_id AND facility.company_id=rule.company_id
       WHERE rule.company_id=$1 ORDER BY rule.created_at DESC, rule.id DESC`, [companyId]);
    return result.rows.map((row) => this.formatRule(row));
  }

  async createRule(companyId, userId, input = {}) {
    const { value, errors } = controls.validateRule(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_RULE_INVALID', message: errors.join(' '), details: errors };
    const [facilityResult, evidenceResult] = await Promise.all([
      this.database.query('SELECT id FROM industrial_facility_revisions WHERE id=$1 AND company_id=$2', [value.facilityRevisionId, companyId]),
      value.evidenceDocumentId
        ? this.database.query('SELECT id,document_name,status,checksum_sha256,file_size_bytes FROM evidence_documents WHERE id=$1 AND company_id=$2', [value.evidenceDocumentId, companyId])
        : Promise.resolve({ rows: [] })
    ]);
    if (!facilityResult.rows[0]) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_FACILITY_INVALID', message: 'Facility revision must belong to the active company.' };
    const evidence = evidenceResult.rows[0];
    if (value.approvalStatus === 'approved' && (!evidence || !CONTROLLED_EVIDENCE.has(evidence.status)
      || !/^[a-f0-9]{64}$/i.test(evidence.checksum_sha256 || '') || Number(evidence.file_size_bytes || 0) <= 0)) {
      return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_EVIDENCE_NOT_CONTROLLED', message: 'Approved rules require locked or independently verified non-empty evidence with a SHA-256 checksum.' };
    }
    const evidenceSnapshot = evidence ? { id: evidence.id, documentName: evidence.document_name, status: evidence.status,
      checksumSha256: evidence.checksum_sha256, fileSizeBytes: Number(evidence.file_size_bytes) } : {};
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:industrial-allocation:${value.allocationReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industrial_allocation_rule_revisions WHERE company_id=$1 AND allocation_reference=$2', [companyId, value.allocationReference]);
      const inserted = await client.query(
        `INSERT INTO industrial_allocation_rule_revisions
          (company_id,facility_revision_id,allocation_reference,revision,source_level,target_level,allocation_method,
           driver_unit,methodology_reference,methodology_version,rationale,approval_status,evidence_document_id,
           evidence_snapshot,rule_sha256,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) RETURNING *`,
        [companyId, value.facilityRevisionId, value.allocationReference, Number(next.rows[0].revision), value.sourceLevel,
          value.targetLevel, value.allocationMethod, value.driverUnit, value.methodologyReference, value.methodologyVersion,
          value.rationale, value.approvalStatus, value.evidenceDocumentId, JSON.stringify(evidenceSnapshot), value.ruleSha256, userId]);
      await client.query('COMMIT');
      return this.formatRule(inserted.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listRuns(companyId, limit = 100) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
    const result = await this.database.query(
      `SELECT run.*, rule.allocation_reference, rule.revision AS rule_revision, rule.source_level, rule.target_level,
              rule.allocation_method, rule.driver_unit,
              COALESCE((SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number)
                FROM industrial_allocation_lines line WHERE line.company_id=run.company_id AND line.run_id=run.id), '[]'::jsonb) AS lines
       FROM industrial_allocation_runs run
       JOIN industrial_allocation_rule_revisions rule ON rule.id=run.rule_revision_id AND rule.company_id=run.company_id
       WHERE run.company_id=$1 ORDER BY run.created_at DESC, run.id DESC LIMIT $2`, [companyId, safeLimit]);
    return result.rows.map((row) => this.formatRun(row));
  }

  async getRun(companyId, runId) {
    if (!controls.UUID.test(String(runId || ''))) return null;
    const result = await this.database.query(
      `SELECT run.*, rule.allocation_reference, rule.revision AS rule_revision, rule.source_level, rule.target_level,
              rule.allocation_method, rule.driver_unit,
              COALESCE((SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number)
                FROM industrial_allocation_lines line WHERE line.company_id=run.company_id AND line.run_id=run.id), '[]'::jsonb) AS lines
       FROM industrial_allocation_runs run
       JOIN industrial_allocation_rule_revisions rule ON rule.id=run.rule_revision_id AND rule.company_id=run.company_id
       WHERE run.company_id=$1 AND run.id=$2`, [companyId, runId]);
    return result.rows[0] ? this.formatRun(result.rows[0]) : null;
  }

  async createRun(companyId, userId, input = {}) {
    const { value, errors } = controls.validateRun(input);
    if (errors.length) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_RUN_INVALID', message: errors.join(' '), details: errors };
    const ruleResult = await this.database.query('SELECT * FROM industrial_allocation_rule_revisions WHERE id=$1 AND company_id=$2', [value.ruleRevisionId, companyId]);
    const rule = ruleResult.rows[0];
    if (!rule) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_RULE_NOT_FOUND', message: 'Allocation rule revision was not found.' };
    if (rule.approval_status !== 'approved') return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_RULE_NOT_APPROVED', message: 'Only an approved allocation rule may create a run.' };

    const sourceResult = value.sourceActivityId
      ? await this.database.query('SELECT id,facility_revision_id,process_revision_id,quantity,canonical_unit,source_sha256,activity_reference FROM industrial_activity_records WHERE id=$1 AND company_id=$2', [value.sourceActivityId, companyId])
      : await this.database.query(
        `SELECT line.id,line.target_level,line.target_entity_id,line.target_reference,line.allocated_quantity AS quantity,
                line.canonical_unit,run.facility_revision_id,line.line_sha256
         FROM industrial_allocation_lines line
         JOIN industrial_allocation_runs run ON run.id=line.run_id AND run.company_id=line.company_id
         WHERE line.id=$1 AND line.company_id=$2`, [value.sourceAllocationLineId, companyId]);
    const source = sourceResult.rows[0];
    if (!source || source.facility_revision_id !== rule.facility_revision_id) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_SOURCE_INVALID', message: 'Source must belong to the rule facility and active company.' };
    if (value.sourceAllocationLineId && source.target_level !== rule.source_level) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_LEVEL_MISMATCH', message: 'The source allocation line level must match the rule sourceLevel.' };
    if (value.sourceActivityId && rule.source_level === 'process' && !source.process_revision_id) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_LEVEL_MISMATCH', message: 'A process-level rule requires an activity bound to a process.' };
    if (value.sourceActivityId && rule.source_level === 'batch') return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_LEVEL_MISMATCH', message: 'A batch-level rule must continue from an existing batch allocation line.' };

    const targets = await this.resolveTargets(companyId, rule, value.targets);
    if (targets.blocked) return targets;
    const result = controls.calculateAllocation({ sourceQuantity: Number(source.quantity), sourceUnit: source.canonical_unit,
      driverUnit: rule.driver_unit, targets: targets.items });
    const sourceSnapshot = value.sourceActivityId
      ? { kind: 'activity', id: source.id, reference: source.activity_reference, sourceSha256: source.source_sha256,
        quantity: Number(source.quantity), unit: source.canonical_unit, processRevisionId: source.process_revision_id }
      : { kind: 'allocation_line', id: source.id, targetLevel: source.target_level, targetEntityId: source.target_entity_id,
        targetReference: source.target_reference, lineSha256: source.line_sha256, quantity: Number(source.quantity), unit: source.canonical_unit };
    const ruleSnapshot = { id: rule.id, allocationReference: rule.allocation_reference, revision: Number(rule.revision),
      sourceLevel: rule.source_level, targetLevel: rule.target_level, allocationMethod: rule.allocation_method,
      driverUnit: rule.driver_unit, methodologyReference: rule.methodology_reference,
      methodologyVersion: rule.methodology_version, rationale: rule.rationale, ruleSha256: rule.rule_sha256,
      evidenceSnapshot: rule.evidence_snapshot };
    const payload = { schemaId: controls.RULESET.schemaId, schemaVersion: controls.RULESET.schemaVersion, ruleset: controls.RULESET.version,
      facilityRevisionId: rule.facility_revision_id, source: sourceSnapshot, rule: ruleSnapshot,
      driverTotal: result.driverTotal, allocatedQuantity: result.allocatedQuantity,
      reconciliationDifference: result.reconciliationDifference, lines: result.lines.map((line) => ({
        targetLevel: rule.target_level, targetEntityId: line.targetEntityId, targetReference: line.targetReference,
        driverValue: line.driverValue, driverUnit: line.driverUnit, allocationShare: line.allocationShare,
        allocatedQuantity: line.allocatedQuantity, canonicalUnit: line.canonicalUnit })) };
    const payloadSha256 = controls.sha256(payload);

    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:allocation-run:${payloadSha256}`]);
      const existing = await client.query('SELECT id FROM industrial_allocation_runs WHERE company_id=$1 AND payload_sha256=$2', [companyId, payloadSha256]);
      if (existing.rows[0]) { await client.query('COMMIT'); return this.getRun(companyId, existing.rows[0].id); }
      const inserted = await client.query(
        `INSERT INTO industrial_allocation_runs
          (company_id,facility_revision_id,rule_revision_id,source_kind,source_activity_id,source_allocation_line_id,
           source_quantity,source_unit,driver_total,allocated_quantity,reconciliation_difference,reconciliation_status,
           source_snapshot,rule_snapshot,payload_sha256,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reconciled',$12::jsonb,$13::jsonb,$14,$15) RETURNING *`,
        [companyId, rule.facility_revision_id, rule.id, value.sourceActivityId ? 'activity' : 'allocation_line',
          value.sourceActivityId, value.sourceAllocationLineId, Number(source.quantity), source.canonical_unit,
          result.driverTotal, result.allocatedQuantity, result.reconciliationDifference, JSON.stringify(sourceSnapshot),
          JSON.stringify(ruleSnapshot), payloadSha256, userId]);
      const lines = [];
      for (let index = 0; index < result.lines.length; index += 1) {
        const line = result.lines[index];
        const linePayload = { runPayloadSha256: payloadSha256, lineNumber: index + 1, targetLevel: rule.target_level,
          targetEntityId: line.targetEntityId, targetReference: line.targetReference, driverValue: line.driverValue,
          driverUnit: line.driverUnit, allocationShare: line.allocationShare, allocatedQuantity: line.allocatedQuantity,
          canonicalUnit: line.canonicalUnit };
        const lineSha256 = controls.sha256(linePayload);
        const saved = await client.query(
          `INSERT INTO industrial_allocation_lines
            (company_id,run_id,line_number,target_level,target_entity_id,target_reference,driver_value,driver_unit,
             allocation_share,allocated_quantity,canonical_unit,line_sha256)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [companyId, inserted.rows[0].id, index + 1, rule.target_level, line.targetEntityId, line.targetReference,
            line.driverValue, line.driverUnit, line.allocationShare, line.allocatedQuantity, line.canonicalUnit, lineSha256]);
        lines.push(saved.rows[0]);
      }
      await client.query('COMMIT');
      return this.formatRun({ ...inserted.rows[0], allocation_reference: rule.allocation_reference,
        rule_revision: rule.revision, source_level: rule.source_level, target_level: rule.target_level,
        allocation_method: rule.allocation_method, driver_unit: rule.driver_unit, lines });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async resolveTargets(companyId, rule, targets) {
    const ids = targets.map((target) => target.targetEntityId);
    const queryByLevel = {
      process: ['SELECT id,process_reference AS reference FROM industrial_process_revisions WHERE company_id=$1 AND facility_revision_id=$2 AND id=ANY($3::uuid[])', [companyId, rule.facility_revision_id, ids]],
      batch: ['SELECT id,batch_name AS reference FROM product_batches WHERE company_id=$1 AND id=ANY($2::uuid[])', [companyId, ids]],
      product: ['SELECT id,COALESCE(NULLIF(sku,\'\'),name) AS reference FROM products WHERE company_id=$1 AND id=ANY($2::uuid[])', [companyId, ids]]
    };
    const [sql, params] = queryByLevel[rule.target_level];
    const result = await this.database.query(sql, params);
    if (result.rows.length !== ids.length) return { blocked: true, code: 'INDUSTRIAL_ALLOCATION_TARGET_INVALID', message: 'Every allocation target must exist at the rule targetLevel and belong to the active company/facility.' };
    const byId = new Map(result.rows.map((row) => [row.id, row.reference]));
    return { items: targets.map((target) => ({ ...target, targetReference: byId.get(target.targetEntityId) })) };
  }

  formatRule(row) {
    return { id: row.id, facilityRevisionId: row.facility_revision_id, facilityReference: row.facility_reference,
      facilityName: row.facility_name, allocationReference: row.allocation_reference, revision: Number(row.revision),
      sourceLevel: row.source_level, targetLevel: row.target_level, allocationMethod: row.allocation_method,
      driverUnit: row.driver_unit, methodologyReference: row.methodology_reference,
      methodologyVersion: row.methodology_version, rationale: row.rationale, approvalStatus: row.approval_status,
      evidenceDocumentId: row.evidence_document_id, evidenceSnapshot: row.evidence_snapshot,
      ruleSha256: row.rule_sha256, createdBy: row.created_by, createdAt: row.created_at };
  }

  formatRun(row) {
    return { id: row.id, facilityRevisionId: row.facility_revision_id, ruleRevisionId: row.rule_revision_id,
      allocationReference: row.allocation_reference, ruleRevision: Number(row.rule_revision), sourceLevel: row.source_level,
      targetLevel: row.target_level, allocationMethod: row.allocation_method, driverUnit: row.driver_unit,
      sourceKind: row.source_kind, sourceActivityId: row.source_activity_id,
      sourceAllocationLineId: row.source_allocation_line_id, sourceQuantity: Number(row.source_quantity),
      sourceUnit: row.source_unit, driverTotal: Number(row.driver_total), allocatedQuantity: Number(row.allocated_quantity),
      reconciliationDifference: Number(row.reconciliation_difference), reconciliationStatus: row.reconciliation_status,
      sourceSnapshot: row.source_snapshot, ruleSnapshot: row.rule_snapshot, payloadSha256: row.payload_sha256,
      lines: (row.lines || []).map((line) => ({ id: line.id, lineNumber: Number(line.line_number),
        targetLevel: line.target_level, targetEntityId: line.target_entity_id, targetReference: line.target_reference,
        driverValue: Number(line.driver_value), driverUnit: line.driver_unit, allocationShare: Number(line.allocation_share),
        allocatedQuantity: Number(line.allocated_quantity), canonicalUnit: line.canonical_unit,
        lineSha256: line.line_sha256 })), createdBy: row.created_by, createdAt: row.created_at,
      disclaimer: controls.RULESET.disclaimer };
  }
}

module.exports = { DynamicAllocationService, dynamicAllocationService: new DynamicAllocationService() };
