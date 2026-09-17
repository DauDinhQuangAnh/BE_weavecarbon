const crypto = require('crypto');

const RULESET = Object.freeze({
  schemaId: 'weavecarbon.dynamic-allocation',
  schemaVersion: '1.0.0',
  version: 'G2-ALLOCATION-2026.09.17.1',
  precision: 8,
  disclaimer: 'Internal deterministic allocation lineage. A reconciled run does not by itself approve the methodology, product footprint, regulatory filing or external claim.'
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(['mass', 'energy', 'output', 'machine_hour', 'economic', 'custom_driver']);
const NEXT_LEVELS = Object.freeze({
  facility: new Set(['process', 'batch', 'product']),
  process: new Set(['batch', 'product']),
  batch: new Set(['product'])
});

function text(value) { return String(value ?? '').trim(); }
function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function normalizeRule(input = {}) {
  return {
    allocationReference: text(input.allocationReference || input.allocation_reference),
    facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    sourceLevel: text(input.sourceLevel || input.source_level).toLowerCase(),
    targetLevel: text(input.targetLevel || input.target_level).toLowerCase(),
    allocationMethod: text(input.allocationMethod || input.allocation_method).toLowerCase(),
    driverUnit: text(input.driverUnit || input.driver_unit),
    methodologyReference: text(input.methodologyReference || input.methodology_reference),
    methodologyVersion: text(input.methodologyVersion || input.methodology_version),
    rationale: text(input.rationale),
    approvalStatus: text(input.approvalStatus || input.approval_status).toLowerCase() || 'draft',
    evidenceDocumentId: text(input.evidenceDocumentId || input.evidence_document_id) || null
  };
}

function validateRule(input = {}) {
  const value = normalizeRule(input); const errors = [];
  if (!value.allocationReference || value.allocationReference.length > 120) errors.push('allocationReference is required and must not exceed 120 characters.');
  if (!UUID.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!NEXT_LEVELS[value.sourceLevel]?.has(value.targetLevel)) errors.push('sourceLevel and targetLevel must move forward through facility, process, batch and product.');
  if (!METHODS.has(value.allocationMethod)) errors.push('allocationMethod is invalid.');
  if (!value.driverUnit || value.driverUnit.length > 100) errors.push('driverUnit is required and must not exceed 100 characters.');
  if (!value.methodologyReference || value.methodologyReference.length > 500) errors.push('methodologyReference is required and must not exceed 500 characters.');
  if (!value.methodologyVersion || value.methodologyVersion.length > 120) errors.push('methodologyVersion is required and must not exceed 120 characters.');
  if (!value.rationale || value.rationale.length > 5000) errors.push('rationale is required and must not exceed 5000 characters.');
  if (!['draft', 'approved'].includes(value.approvalStatus)) errors.push('approvalStatus must be draft or approved.');
  if (value.approvalStatus === 'approved' && !UUID.test(value.evidenceDocumentId || '')) errors.push('Approved rules require an evidenceDocumentId UUID.');
  if (value.evidenceDocumentId && !UUID.test(value.evidenceDocumentId)) errors.push('evidenceDocumentId must be a UUID.');
  const ruleIdentity = { ...value, ruleset: RULESET.version };
  return { value: { ...value, ruleSha256: sha256(ruleIdentity) }, errors };
}

function normalizeRun(input = {}) {
  const sourceActivityId = text(input.sourceActivityId || input.source_activity_id) || null;
  const sourceAllocationLineId = text(input.sourceAllocationLineId || input.source_allocation_line_id) || null;
  const targets = (Array.isArray(input.targets) ? input.targets : []).map((target) => ({
    targetEntityId: text(target.targetEntityId || target.target_entity_id),
    driverValue: number(target.driverValue ?? target.driver_value)
  }));
  return { ruleRevisionId: text(input.ruleRevisionId || input.rule_revision_id), sourceActivityId, sourceAllocationLineId, targets };
}

function validateRun(input = {}) {
  const value = normalizeRun(input); const errors = [];
  if (!UUID.test(value.ruleRevisionId)) errors.push('ruleRevisionId must be a UUID.');
  if (Boolean(value.sourceActivityId) === Boolean(value.sourceAllocationLineId)) errors.push('Exactly one sourceActivityId or sourceAllocationLineId is required.');
  if (value.sourceActivityId && !UUID.test(value.sourceActivityId)) errors.push('sourceActivityId must be a UUID.');
  if (value.sourceAllocationLineId && !UUID.test(value.sourceAllocationLineId)) errors.push('sourceAllocationLineId must be a UUID.');
  if (value.targets.length < 1 || value.targets.length > 500) errors.push('targets must contain between 1 and 500 rows.');
  if (value.targets.some((target) => !UUID.test(target.targetEntityId))) errors.push('Every targetEntityId must be a UUID.');
  if (value.targets.some((target) => target.driverValue === null || target.driverValue <= 0)) errors.push('Every driverValue must be greater than zero.');
  if (new Set(value.targets.map((target) => target.targetEntityId)).size !== value.targets.length) errors.push('targetEntityId values must be unique.');
  return { value, errors };
}

function calculateAllocation({ sourceQuantity, sourceUnit, driverUnit, targets }) {
  const quantity = number(sourceQuantity);
  if (quantity === null || quantity < 0) throw new Error('sourceQuantity must be zero or greater.');
  const ordered = [...targets].sort((left, right) => left.targetEntityId.localeCompare(right.targetEntityId));
  const driverTotal = ordered.reduce((sum, target) => sum + target.driverValue, 0);
  if (!Number.isFinite(driverTotal) || driverTotal <= 0) throw new Error('Driver total must be greater than zero.');
  let allocatedSoFar = 0;
  const lines = ordered.map((target, index) => {
    const share = target.driverValue / driverTotal;
    const allocatedQuantity = index === ordered.length - 1
      ? Number((quantity - allocatedSoFar).toFixed(RULESET.precision))
      : Number((quantity * share).toFixed(RULESET.precision));
    allocatedSoFar = Number((allocatedSoFar + allocatedQuantity).toFixed(RULESET.precision));
    return { ...target, driverValue: Number(target.driverValue.toFixed(RULESET.precision)), driverUnit,
      allocationShare: Number(share.toFixed(12)), allocatedQuantity, canonicalUnit: sourceUnit };
  });
  const allocatedQuantity = Number(lines.reduce((sum, line) => sum + line.allocatedQuantity, 0).toFixed(RULESET.precision));
  const reconciliationDifference = Number((quantity - allocatedQuantity).toFixed(RULESET.precision));
  return { driverTotal: Number(driverTotal.toFixed(RULESET.precision)), allocatedQuantity, reconciliationDifference, lines };
}

module.exports = { RULESET, UUID, validateRule, validateRun, calculateAllocation, sha256 };
