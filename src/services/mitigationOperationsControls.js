const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RULESET = Object.freeze({
  id: 'weavecarbon.vn-mitigation-allowance-operations', version: 'G2-04-2026.09.15-1', coverage: 'internal-operations',
  sources: Object.freeze([
    { id: 'ND-06-2022', title: 'Nghị định 06/2022/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=1&docid=205039&orggroupid=2&pageid=27160' },
    { id: 'ND-119-2025', title: 'Nghị định 119/2025/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=1&docid=213875&orggroupid=2&pageid=27160', effectiveFrom: '2025-08-01' },
    { id: 'ND-83-2026', title: 'Nghị định 83/2026/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=0&docid=217277&pageid=27160', effectiveFrom: '2026-03-23' },
    { id: 'QD-232-2025', title: 'Quyết định 232/QĐ-TTg', url: 'https://vanban.chinhphu.vn/?classid=0&docid=212592&pageid=27160', issuedOn: '2025-01-24' }
  ]),
  disclaimer: 'Internal planning and reference ledger only. Allowances and credits are not netted from gross GHG inventory totals. Records do not prove registry ownership, eligibility, transfer, surrender or regulatory compliance.'
});
function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function number(value) { return value === '' || value === null || value === undefined ? null : Number(value); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function uniqueIds(value) { return [...new Set(array(value).map(text).filter(Boolean))]; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }

function validateInitiative(input = {}) {
  const value = { initiativeReference: text(input.initiativeReference || input.initiative_reference), facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    title: text(input.title), lifecycleStatus: text(input.lifecycleStatus || input.lifecycle_status).toLowerCase(), ownerName: text(input.ownerName || input.owner_name),
    baselineYear: Number(input.baselineYear || input.baseline_year), baselineInventoryId: text(input.baselineInventoryId || input.baseline_inventory_id) || null,
    targetReductionTco2e: number(input.targetReductionTco2e ?? input.target_reduction_tco2e), plannedStart: text(input.plannedStart || input.planned_start),
    plannedEnd: text(input.plannedEnd || input.planned_end), methodology: object(input.methodology), assumptions: object(input.assumptions),
    evidenceDocumentIds: uniqueIds(input.evidenceDocumentIds || input.evidence_document_ids), evidenceRole: text(input.evidenceRole || input.evidence_role).toLowerCase() || 'methodology' };
  const errors = [];
  if (!value.initiativeReference || value.initiativeReference.length > 120) errors.push('initiativeReference is required.');
  if (!UUID.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!value.title || value.title.length > 240 || !value.ownerName) errors.push('title and ownerName are required.');
  if (!['proposed', 'approved_internal', 'in_progress', 'completed', 'cancelled'].includes(value.lifecycleStatus)) errors.push('lifecycleStatus is invalid.');
  if (!Number.isInteger(value.baselineYear) || value.baselineYear < 2020 || value.baselineYear > 2200) errors.push('baselineYear is invalid.');
  if (value.baselineInventoryId && !UUID.test(value.baselineInventoryId)) errors.push('baselineInventoryId must be a UUID.');
  if (!Number.isFinite(value.targetReductionTco2e) || value.targetReductionTco2e <= 0) errors.push('targetReductionTco2e must be greater than zero.');
  if (!validDate(value.plannedStart) || !validDate(value.plannedEnd) || value.plannedEnd < value.plannedStart) errors.push('A valid plannedStart and plannedEnd are required.');
  if (!Object.keys(value.methodology).length || !Object.keys(value.assumptions).length) errors.push('methodology and assumptions are required.');
  if (!value.evidenceDocumentIds.length || value.evidenceDocumentIds.some((id) => !UUID.test(id))) errors.push('At least one evidence UUID is required.');
  if (!['baseline', 'methodology', 'approval', 'implementation', 'monitoring', 'verification'].includes(value.evidenceRole)) errors.push('evidenceRole is invalid.');
  return { value: { ...value, initiativeSha256: sha(value) }, errors };
}

function validateScenario(input = {}) {
  const value = { initiativeId: text(input.initiativeId || input.initiative_id), scenarioReference: text(input.scenarioReference || input.scenario_reference),
    scenarioType: text(input.scenarioType || input.scenario_type).toLowerCase(), periodStart: text(input.periodStart || input.period_start), periodEnd: text(input.periodEnd || input.period_end),
    baselineEmissionsTco2e: number(input.baselineEmissionsTco2e ?? input.baseline_emissions_tco2e), projectedEmissionsTco2e: number(input.projectedEmissionsTco2e ?? input.projected_emissions_tco2e),
    annualProjection: array(input.annualProjection || input.annual_projection), assumptions: object(input.assumptions), sensitivity: object(input.sensitivity),
    evidenceDocumentIds: uniqueIds(input.evidenceDocumentIds || input.evidence_document_ids) };
  value.expectedReductionTco2e = Number.isFinite(value.baselineEmissionsTco2e) && Number.isFinite(value.projectedEmissionsTco2e)
    ? Number((value.baselineEmissionsTco2e - value.projectedEmissionsTco2e).toFixed(6)) : null;
  const errors = [];
  if (!UUID.test(value.initiativeId)) errors.push('initiativeId must be a UUID.');
  if (!value.scenarioReference || value.scenarioReference.length > 120) errors.push('scenarioReference is required.');
  if (!['baseline', 'planned', 'conservative', 'stress'].includes(value.scenarioType)) errors.push('scenarioType is invalid.');
  if (!validDate(value.periodStart) || !validDate(value.periodEnd) || value.periodEnd < value.periodStart) errors.push('A valid scenario period is required.');
  if (!Number.isFinite(value.baselineEmissionsTco2e) || value.baselineEmissionsTco2e < 0 || !Number.isFinite(value.projectedEmissionsTco2e) || value.projectedEmissionsTco2e < 0) errors.push('Scenario emissions must be zero or greater.');
  if (!Number.isFinite(value.expectedReductionTco2e) || value.expectedReductionTco2e < 0) errors.push('projectedEmissionsTco2e cannot exceed the baseline for a mitigation scenario.');
  if (!value.annualProjection.length || !Object.keys(value.assumptions).length || !Object.keys(value.sensitivity).length) errors.push('annualProjection, assumptions and sensitivity are required.');
  if (!value.evidenceDocumentIds.length || value.evidenceDocumentIds.some((id) => !UUID.test(id))) errors.push('At least one evidence UUID is required.');
  return { value: { ...value, scenarioSha256: sha(value) }, errors };
}

function legalBasisSnapshot() { return { rulesetId: RULESET.id, rulesetVersion: RULESET.version, coverage: RULESET.coverage, sources: RULESET.sources, disclaimer: RULESET.disclaimer }; }
function validateAllocation(input = {}) {
  const value = { allocationReference: text(input.allocationReference || input.allocation_reference), facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    reportingYear: Number(input.reportingYear || input.reporting_year), instrumentType: text(input.instrumentType || input.instrument_type).toLowerCase(),
    recordStatus: text(input.recordStatus || input.record_status).toLowerCase(), quantityTco2e: number(input.quantityTco2e ?? input.quantity_tco2e),
    vintageYear: input.vintageYear || input.vintage_year ? Number(input.vintageYear || input.vintage_year) : null, externalReference: text(input.externalReference || input.external_reference) || null,
    evidenceDocumentId: text(input.evidenceDocumentId || input.evidence_document_id) || null, notes: text(input.notes) };
  const errors = [];
  if (!value.allocationReference || value.allocationReference.length > 120) errors.push('allocationReference is required.');
  if (!UUID.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!Number.isInteger(value.reportingYear) || value.reportingYear < 2020 || value.reportingYear > 2200) errors.push('reportingYear is invalid.');
  if (!['authority_quota', 'internal_budget', 'transfer_reference', 'credit_reference'].includes(value.instrumentType)) errors.push('instrumentType is invalid.');
  if (!['draft_reference', 'evidence_confirmed'].includes(value.recordStatus)) errors.push('recordStatus is invalid.');
  if (!Number.isFinite(value.quantityTco2e) || value.quantityTco2e <= 0) errors.push('quantityTco2e must be greater than zero.');
  if (value.vintageYear !== null && (!Number.isInteger(value.vintageYear) || value.vintageYear < 2020 || value.vintageYear > 2200)) errors.push('vintageYear is invalid.');
  if (!value.notes || value.notes.length > 5000) errors.push('notes are required.');
  if (value.recordStatus === 'evidence_confirmed' && (!value.externalReference || !UUID.test(value.evidenceDocumentId))) errors.push('Evidence-confirmed records require an external reference and evidence UUID.');
  if (value.evidenceDocumentId && !UUID.test(value.evidenceDocumentId)) errors.push('evidenceDocumentId must be a UUID.');
  return { value: { ...value, legalBasis: legalBasisSnapshot(), allocationSha256: sha(value) }, errors };
}

function positionReadiness({ inventory, allocations = [], scenarios = [], facilityActivityCount = 0, reportingYearMatches = true }) {
  const blockers = [];
  if (!inventory || inventory.automated_status !== 'inventory_review_required' || inventory.result_snapshot?.automatedStatus === 'needs_information') blockers.push('POSITION_INVENTORY_NOT_READY');
  if (inventory && inventory.latest_review_decision !== 'approved_for_internal_report') blockers.push('POSITION_INVENTORY_REVIEW_REQUIRED');
  if (!reportingYearMatches) blockers.push('POSITION_REPORTING_YEAR_MISMATCH');
  if (!facilityActivityCount) blockers.push('POSITION_FACILITY_ACTIVITY_REQUIRED');
  if (!allocations.length) blockers.push('POSITION_ALLOCATION_REQUIRED');
  if (allocations.some((row) => row.record_status !== 'evidence_confirmed')) blockers.push('POSITION_ALLOCATION_EVIDENCE_REQUIRED');
  if (!allocations.some((row) => row.instrument_type === 'authority_quota')) blockers.push('POSITION_AUTHORITY_QUOTA_REQUIRED');
  if (scenarios.some((row) => !array(row.evidence_snapshot).length)) blockers.push('POSITION_SCENARIO_EVIDENCE_REQUIRED');
  return { status: blockers.length ? 'needs_information' : 'ready_for_internal_review', blockers };
}

module.exports = { RULESET, validateInitiative, validateScenario, validateAllocation, positionReadiness, sha };
