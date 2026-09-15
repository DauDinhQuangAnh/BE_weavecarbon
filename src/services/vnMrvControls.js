const crypto = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RULESET = Object.freeze({ id: 'weavecarbon.vn-facility-mrv', version: 'VN-MRV-2026.09.15-1', coverage: 'limited-preparation',
  sources: Object.freeze([
    { id: 'ND-06-2022', title: 'Nghị định 06/2022/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=1&docid=205039&orggroupid=2&pageid=27160' },
    { id: 'ND-119-2025', title: 'Nghị định 119/2025/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=1&docid=213875&orggroupid=2&pageid=27160', effectiveFrom: '2025-08-01' },
    { id: 'ND-83-2026', title: 'Nghị định 83/2026/NĐ-CP', url: 'https://vanban.chinhphu.vn/?classid=0&docid=217277&pageid=27160', effectiveFrom: '2026-03-23' }
  ]), disclaimer: 'Internal preparation workflow only. It does not determine legal applicability, perform independent verification or submit to a Vietnamese authority.' });
function text(v) { return String(v ?? '').trim(); } function array(v) { return Array.isArray(v) ? v : []; }
function sha(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function legalBasisFor(date) {
  const day = text(date); const list = day >= '2026-09-25'
    ? { id: 'QD-42-2026', title: 'Quyết định 42/2026/QĐ-TTg', effectiveFrom: '2026-09-25', status: 'effective' }
    : { id: 'QD-13-2024', title: 'Quyết định 13/2024/QĐ-TTg', effectiveFrom: '2024-10-01', effectiveTo: '2026-09-24', status: 'effective' };
  return { rulesetId: RULESET.id, rulesetVersion: RULESET.version, coverage: RULESET.coverage, assessedOn: day,
    sources: [...RULESET.sources, list], disclaimer: RULESET.disclaimer };
}
function validateCase(input = {}) {
  const value = { caseReference: text(input.caseReference || input.case_reference), facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    reportingYear: Number(input.reportingYear || input.reporting_year), sector: text(input.sector).toLowerCase(),
    applicabilityStatus: text(input.applicabilityStatus || input.applicability_status).toLowerCase(), listingReference: text(input.listingReference || input.listing_reference) || null,
    listingEvidenceDocumentId: text(input.listingEvidenceDocumentId || input.listing_evidence_document_id) || null,
    assessmentDate: text(input.assessmentDate || input.assessment_date), rationale: text(input.rationale) }; const errors = [];
  if (!value.caseReference || value.caseReference.length > 120) errors.push('caseReference is required.');
  if (!UUID.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!Number.isInteger(value.reportingYear) || value.reportingYear < 2020 || value.reportingYear > 2200) errors.push('reportingYear is invalid.');
  if (!['energy', 'industry_trade', 'transport', 'construction', 'agriculture_environment', 'waste', 'other'].includes(value.sector)) errors.push('sector is invalid.');
  if (!['confirmed_listed', 'potentially_listed', 'not_listed', 'undetermined'].includes(value.applicabilityStatus)) errors.push('applicabilityStatus is invalid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.assessmentDate)) errors.push('assessmentDate is required.');
  if (!value.rationale || value.rationale.length > 5000) errors.push('rationale is required.');
  if (value.applicabilityStatus === 'confirmed_listed' && (!value.listingReference || !UUID.test(value.listingEvidenceDocumentId))) errors.push('Confirmed listing requires a listing reference and evidence UUID.');
  return { value: { ...value, legalBasis: legalBasisFor(value.assessmentDate) }, errors };
}
function validatePlan(input = {}) {
  const value = { caseId: text(input.caseId || input.case_id), planReference: text(input.planReference || input.plan_reference),
    organizationalBoundary: input.organizationalBoundary || {}, operationalBoundary: input.operationalBoundary || {}, sourceMap: array(input.sourceMap),
    methodology: input.methodology || {}, qaqcPlan: input.qaqcPlan || {}, uncertaintyPlan: input.uncertaintyPlan || {},
    dqlAssessmentIds: array(input.dqlAssessmentIds).map(text), evidenceDocumentIds: array(input.evidenceDocumentIds).map(text) }; const errors = [];
  if (!UUID.test(value.caseId)) errors.push('caseId must be a UUID.'); if (!value.planReference) errors.push('planReference is required.');
  if (!Object.keys(value.organizationalBoundary).length || !Object.keys(value.operationalBoundary).length) errors.push('Organizational and operational boundaries are required.');
  if (!value.sourceMap.length) errors.push('At least one sourceMap row is required.');
  if (!Object.keys(value.methodology).length || !Object.keys(value.qaqcPlan).length || !Object.keys(value.uncertaintyPlan).length) errors.push('Methodology, QA/QC and uncertainty plans are required.');
  if (value.dqlAssessmentIds.some((id) => !UUID.test(id)) || value.evidenceDocumentIds.some((id) => !UUID.test(id))) errors.push('DQL and evidence ids must be UUIDs.');
  return { value: { ...value, planSha256: sha(value) }, errors };
}
function filingReadiness({ mrvCase, plan, inventory, dqlRows = [] }) {
  const blockers = [];
  if (!mrvCase || ['undetermined', 'potentially_listed'].includes(mrvCase.applicability_status)) blockers.push('MRV_APPLICABILITY_UNRESOLVED');
  if (!plan) blockers.push('MRV_MEASUREMENT_PLAN_REQUIRED');
  if (!inventory || !['inventory_review_required'].includes(inventory.automated_status)) blockers.push('MRV_INVENTORY_NOT_READY');
  if (!inventory?.result_snapshot || inventory.result_snapshot.automatedStatus === 'needs_information') blockers.push('MRV_INVENTORY_BLOCKERS');
  if (!dqlRows.length || dqlRows.some((row) => ['L1', 'L2'].includes(row.data_quality_level))) blockers.push('MRV_DQL_GATE_FAILED');
  return { status: blockers.length ? 'needs_information' : 'ready_for_specialist_review', blockers };
}
module.exports = { RULESET, legalBasisFor, validateCase, validatePlan, filingReadiness, sha };
