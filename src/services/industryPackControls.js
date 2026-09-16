const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = Object.freeze([
  { id: 'IPCC-2006-METAL', title: '2006 IPCC Guidelines Volume 3 Chapter 4 Metal Industry Emissions', url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/3_Volume3/V3_4_Ch4_Metal_Industry.pdf' },
  { id: 'IPCC-2006-MINERAL', title: '2006 IPCC Guidelines Volume 3 Chapter 2 Mineral Industry Emissions', url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/3_Volume3/V3_2_Ch2_Mineral_Industry.pdf' },
  { id: 'GHGP-PRODUCT', title: 'GHG Protocol Product Life Cycle Accounting and Reporting Standard', url: 'https://ghgprotocol.org/product-standard' }
]);
const PACKS = Object.freeze({
  steel: Object.freeze({ id: 'steel', version: 'G2-STEEL-PILOT-1.0.0', approvalStatus: 'expert_review_required', processes: ['raw_material', 'coke', 'sinter', 'pellet', 'bf', 'bof', 'eaf', 'rolling'], pilotProcesses: ['bf', 'bof', 'eaf'], requiredCategories: ['process', 'fuel', 'electricity'], requiredFields: ['facilityRevisionId', 'processRevisionId', 'outputTonnes', 'activityLines', 'allocation'], evidenceChecklist: ['production', 'activity', 'factor', 'methodology'], targetMappings: ['domestic_mrv_candidate', 'cbam_goods_scope_check_required'], sources: [SOURCES[0], SOURCES[2]] }),
  cement: Object.freeze({ id: 'cement', version: 'G2-CEMENT-PILOT-1.0.0', approvalStatus: 'expert_review_required', processes: ['raw_meal', 'kiln', 'clinker', 'grinding', 'additives'], pilotProcesses: ['kiln', 'clinker'], requiredCategories: ['process', 'fuel', 'electricity'], requiredFields: ['facilityRevisionId', 'processRevisionId', 'outputTonnes', 'activityLines', 'allocation'], evidenceChecklist: ['production', 'carbonate_or_clinker', 'fuel', 'electricity', 'factor', 'methodology'], targetMappings: ['domestic_mrv_candidate', 'cbam_goods_scope_check_required'], sources: [SOURCES[1], SOURCES[2]] })
});
const DISCLAIMER = 'Pilot calculation for internal specialist review only. No default factors, regulatory filing, CBAM eligibility, certification or independent verification is asserted.';
function text(value) { return String(value ?? '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function arr(value) { return Array.isArray(value) ? value : []; }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalize(input = {}) {
  return { packId: text(input.packId), facilityRevisionId: text(input.facilityRevisionId), processRevisionId: text(input.processRevisionId),
    studyReference: text(input.studyReference), periodStart: text(input.periodStart), periodEnd: text(input.periodEnd), outputTonnes: Number(input.outputTonnes),
    productReference: text(input.productReference), allocation: object(input.allocation), methodology: object(input.methodology),
    productionEvidenceDocumentIds: [...new Set(arr(input.productionEvidenceDocumentIds).map(text))],
    activityLines: arr(input.activityLines).map((row) => ({ category: text(row.category), sourceReference: text(row.sourceReference), activityQuantity: Number(row.activityQuantity), activityUnit: text(row.activityUnit), factorProposalId: text(row.factorProposalId), evidenceDocumentIds: [...new Set(arr(row.evidenceDocumentIds).map(text))] })) };
}
function validate(input = {}) {
  const value = normalize(input); const pack = PACKS[value.packId]; const errors = [];
  if (!pack) errors.push('packId must be steel or cement.');
  for (const field of ['facilityRevisionId', 'processRevisionId']) if (!UUID.test(value[field])) errors.push(`${field} must be a UUID.`);
  if (!value.studyReference || value.studyReference.length > 120) errors.push('studyReference is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(value.periodEnd) || value.periodEnd < value.periodStart) errors.push('A valid reporting period is required.');
  if (!Number.isFinite(value.outputTonnes) || value.outputTonnes <= 0) errors.push('outputTonnes must be greater than zero.');
  if (!value.productReference) errors.push('productReference is required.');
  if (value.allocation.method !== 'single_product' || value.allocation.share !== 1) errors.push('Pilot allocation only supports an evidenced single-product 100% share; co-products require specialist allocation rules.');
  if (!text(value.methodology.boundary) || !text(value.methodology.source)) errors.push('Methodology boundary and source are required.');
  if (!value.productionEvidenceDocumentIds.length || value.productionEvidenceDocumentIds.some((id) => !UUID.test(id))) errors.push('Production evidence UUIDs are required.');
  if (!value.activityLines.length) errors.push('At least one activity line is required.');
  const categories = new Set(value.activityLines.map((line) => line.category));
  if (pack && pack.requiredCategories.some((category) => !categories.has(category))) errors.push(`The ${pack.id} pilot requires process, fuel and electricity lines.`);
  value.activityLines.forEach((line, index) => {
    if (!['process', 'fuel', 'electricity'].includes(line.category) || !line.sourceReference || !Number.isFinite(line.activityQuantity) || line.activityQuantity < 0 || !line.activityUnit || !UUID.test(line.factorProposalId) || !line.evidenceDocumentIds.length || line.evidenceDocumentIds.some((id) => !UUID.test(id))) errors.push(`activityLines[${index}] is incomplete.`);
  });
  return { value, pack, errors };
}
function calculate(value, factors) {
  const byId = new Map(factors.map((factor) => [factor.id, factor])); const findings = []; const lines = value.activityLines.map((line) => {
    const factor = byId.get(line.factorProposalId); const expectedUnit = `kgCO2e/${line.activityUnit}`;
    if (!factor || factor.latest_review_decision !== 'approved_for_release_candidate' || factor.unit !== expectedUnit || factor.is_proxy) findings.push({ code: 'FACTOR_NOT_GOVERNED', sourceReference: line.sourceReference, expectedUnit });
    const kgCo2e = factor && Number.isFinite(Number(factor.factor_value)) ? Number((line.activityQuantity * Number(factor.factor_value)).toFixed(6)) : null;
    return { ...line, factorSnapshot: factor ? { id: factor.id, factorId: factor.factor_id, value: Number(factor.factor_value), unit: factor.unit, payloadSha256: factor.payload_sha256, reviewDecision: factor.latest_review_decision, boundary: factor.boundary, isProxy: factor.is_proxy } : null, kgCo2e };
  });
  if (findings.length) return { status: 'needs_information', findings, lines, totals: null };
  const grossKgCo2e = Number(lines.reduce((total, line) => total + line.kgCo2e, 0).toFixed(6));
  return { status: 'specialist_review_required', findings: [{ code: 'PACK_EXPERT_APPROVAL_PENDING' }, { code: 'FACTOR_BOUNDARY_OVERLAP_REVIEW_REQUIRED' }], lines,
    totals: { grossKgCo2e, grossTco2e: Number((grossKgCo2e / 1000).toFixed(6)), intensityKgCo2ePerTonne: Number((grossKgCo2e / value.outputTonnes).toFixed(6)) } };
}
module.exports = { PACKS, DISCLAIMER, validate, calculate, sha };
