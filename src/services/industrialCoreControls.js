const crypto = require('crypto');
const { normalizeActivityInput, validateActivityInput } = require('../modules/shared');

const VERSION = 'G2-INDUSTRIAL-CORE-2026.09.18.9';
const STATUS = Object.freeze(['implemented', 'partial', 'planned']);

const CAPABILITY_REGISTRY = Object.freeze({
  schemaId: 'weavecarbon.industrial-core-capabilities',
  schemaVersion: '1.0.0',
  platformVersion: VERSION,
  coverage: 'baseline',
  updatedOn: '2026-09-18',
  truthBoundary: 'Only capabilities marked implemented are operational. Partial and planned capabilities must not be presented as production-complete.',
  layers: Object.freeze([
    { id: 'ingestion', label: 'Data ingestion', status: 'partial', evidence: ['manual-entry', 'invoice-upload', 'weavenode-signed-v2-pilot', 'dual-time-provenance', 'device-health-ledger', 'meter-hierarchy-reconciliation', 'signed-staged-update-ledger'], nextGate: 'Real gateway/network soak, mTLS/key custody, signed OTA rollback and site calibration acceptance' },
    { id: 'ai-assisted-ingestion', label: 'AI and OCR human-in-the-loop', status: 'implemented', evidence: ['OCR field suggestions', 'checksum-bound named human review', 'immutable accepted/corrected field decisions', 'deterministic semantic mapping suggestions', 'anomaly and evidence-match decisions', 'separate immutable candidate and named activity promotion', 'factor/calculation-field exclusion', 'RAG evidence ingestion'], nextGate: 'Representative-document accuracy evaluation, model/version acceptance and real-facility human workflow pilot' },
    { id: 'semantic', label: 'Semantic harmonization', status: 'implemented', evidence: ['canonical facility/process/measurement/activity schema', 'tenant-bound revision ledgers'], nextGate: 'extend taxonomy through industry packs' },
    { id: 'evidence', label: 'Evidence and provenance', status: 'implemented', evidence: ['evidence locker', 'activity lineage query', 'immutable review snapshots', 'audit trail'], nextGate: 'cross-workstream graph traversal' },
    { id: 'computation', label: 'Carbon computation and allocation', status: 'implemented', evidence: ['factor registry', 'PCF studies', 'corporate GHG inventory', 'versioned multi-level allocation rules', 'deterministic reconciled allocation lineage'], nextGate: 'real-facility allocation reproducibility pilot and domestic-to-export adapter binding' },
    { id: 'domestic-mrv', label: 'Domestic GHG and MRV operations', status: 'implemented', evidence: ['effective-date legal basis', 'measurement plan revisions', 'corporate inventory linkage', 'filing readiness snapshots'], nextGate: 'specialist pilots and authority-channel integration' },
    { id: 'export', label: 'Export and traceability adapters', status: 'implemented', evidence: ['R01-R20 export workstream'], nextGate: 'map canonical industrial records into adapters' },
    { id: 'data-quality', label: 'Data quality and factor governance', status: 'implemented', evidence: ['versioned DQL scoring', 'immutable factor proposals', 'evidence-gated reviews'], nextGate: 'apply DQL gates to domestic MRV filing packs' },
    { id: 'mitigation-allowance', label: 'Mitigation and allowance operations', status: 'implemented', evidence: ['initiative revisions', 'evidence-backed scenarios', 'allowance allocation references', 'gross-preserving position snapshots'], nextGate: 'specialist pilot and registry reconciliation connector' },
    { id: 'industry-rules', label: 'Industry packs', status: 'partial', evidence: ['seven versioned sector-pack manifests', 'pack-specific taxonomy/context/validation/allocation/evidence/target mappings', 'factor-governed deterministic snapshots', 'deterministic pilot fixtures'], nextGate: 'independent sector-expert approval and real-facility pilots for every pack' },
    { id: 'decision-intelligence', label: 'Climate risk and decision intelligence', status: 'partial', evidence: ['evidence-bound-facility-screening', 'scenario-scoped-portfolio-snapshot', 'tenant-bound-supplier-network', 'transparent-carbon-climate-dependency-criticality', 'immutable-criticality-portfolio'], nextGate: 'Licensed dataset ingestion, calibrated hazard metrics, climate-specialist validation and real facility/supplier acceptance pilots' },
    { id: 'enterprise-security', label: 'Enterprise security and production acceptance', status: 'partial', evidence: ['TOTP MFA with one-time recovery codes', 'MFA-bound access and refresh sessions', 'OIDC configuration validation ledger', 'key and incident lifecycle ledgers', 'evidence-gated production acceptance'], nextGate: 'External IdP interoperability acceptance, live production release evidence, penetration test and incident exercise' }
  ]),
  entities: Object.freeze([
    { id: 'organization', status: 'implemented' }, { id: 'facility', status: 'implemented' },
    { id: 'supplier', status: 'implemented' }, { id: 'material', status: 'implemented' },
    { id: 'product', status: 'implemented' }, { id: 'batch-lot', status: 'implemented' },
    { id: 'process', status: 'implemented' }, { id: 'activity', status: 'implemented' },
    { id: 'emission-source', status: 'partial' }, { id: 'resource-energy', status: 'partial' },
    { id: 'transport', status: 'implemented' }, { id: 'evidence', status: 'implemented' },
    { id: 'meter-device', status: 'implemented' }, { id: 'emission-factor', status: 'implemented' },
    { id: 'methodology', status: 'partial' }, { id: 'calculation-line', status: 'implemented' },
    { id: 'allowance-credit-reference', status: 'implemented' }, { id: 'mitigation-initiative', status: 'implemented' },
    { id: 'review-verification', status: 'implemented' }, { id: 'target-requirement', status: 'planned' }
  ])
});

function text(value) { return String(value ?? '').trim(); }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function getCapabilityRegistry() {
  return { ...CAPABILITY_REGISTRY, manifestSha256: sha256(CAPABILITY_REGISTRY) };
}

function normalizeFacilityInput(input = {}) {
  return { facilityReference: text(input.facilityReference || input.facility_reference), name: text(input.name),
    countryCode: text(input.countryCode || input.country_code).toUpperCase(), timezone: text(input.timezone) || 'Asia/Ho_Chi_Minh',
    lifecycleStatus: text(input.lifecycleStatus || input.lifecycle_status).toLowerCase() || 'active',
    boundaryNotes: text(input.boundaryNotes || input.boundary_notes) || null,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {} };
}

function validateFacilityInput(input = {}) {
  const value = normalizeFacilityInput(input); const errors = [];
  if (!value.facilityReference || value.facilityReference.length > 120) errors.push('facilityReference is required and must not exceed 120 characters.');
  if (!value.name || value.name.length > 240) errors.push('name is required and must not exceed 240 characters.');
  if (!/^[A-Z]{2}$/.test(value.countryCode)) errors.push('countryCode must be a two-letter uppercase ISO code.');
  if (!['planned', 'active', 'inactive'].includes(value.lifecycleStatus)) errors.push('lifecycleStatus is invalid.');
  return { value, errors };
}

function normalizeProcessInput(input = {}) {
  return { facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    processReference: text(input.processReference || input.process_reference), name: text(input.name),
    processType: text(input.processType || input.process_type),
    lifecycleStatus: text(input.lifecycleStatus || input.lifecycle_status).toLowerCase() || 'active',
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {} };
}

function validateProcessInput(input = {}) {
  const value = normalizeProcessInput(input); const errors = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (!value.processReference || value.processReference.length > 120) errors.push('processReference is required and must not exceed 120 characters.');
  if (!value.name || value.name.length > 240) errors.push('name is required and must not exceed 240 characters.');
  if (!value.processType) errors.push('processType is required.');
  if (!['planned', 'active', 'inactive'].includes(value.lifecycleStatus)) errors.push('lifecycleStatus is invalid.');
  return { value, errors };
}

function normalizeMeasurementPointInput(input = {}) {
  const interval = input.samplingIntervalSeconds ?? input.sampling_interval_seconds;
  return { facilityRevisionId: text(input.facilityRevisionId || input.facility_revision_id),
    processRevisionId: text(input.processRevisionId || input.process_revision_id) || null,
    measurementPointReference: text(input.measurementPointReference || input.measurement_point_reference),
    measurementType: text(input.measurementType || input.measurement_type), canonicalUnit: text(input.canonicalUnit || input.canonical_unit),
    sourceType: text(input.sourceType || input.source_type).toLowerCase(), deviceIdentity: text(input.deviceIdentity || input.device_identity) || null,
    calibrationStatus: text(input.calibrationStatus || input.calibration_status).toLowerCase() || 'unknown',
    calibrationDueOn: text(input.calibrationDueOn || input.calibration_due_on) || null,
    samplingIntervalSeconds: interval === '' || interval === null || interval === undefined ? null : Number(interval),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {} };
}

function validateMeasurementPointInput(input = {}) {
  const value = normalizeMeasurementPointInput(input); const errors = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(value.facilityRevisionId)) errors.push('facilityRevisionId must be a UUID.');
  if (value.processRevisionId && !uuid.test(value.processRevisionId)) errors.push('processRevisionId must be a UUID.');
  if (!value.measurementPointReference || value.measurementPointReference.length > 120) errors.push('measurementPointReference is required and must not exceed 120 characters.');
  if (!value.measurementType || !value.canonicalUnit) errors.push('measurementType and canonicalUnit are required.');
  if (!['meter', 'plc', 'sensor', 'weavenode', 'manual', 'api'].includes(value.sourceType)) errors.push('sourceType is invalid.');
  if (!['unknown', 'current', 'expired', 'not_applicable'].includes(value.calibrationStatus)) errors.push('calibrationStatus is invalid.');
  if (value.samplingIntervalSeconds !== null && (!Number.isInteger(value.samplingIntervalSeconds) || value.samplingIntervalSeconds <= 0)) errors.push('samplingIntervalSeconds must be a positive integer.');
  return { value, errors };
}

function validateActivityReviewInput(input = {}) {
  const value = { reviewerRole: text(input.reviewerRole || input.reviewer_role),
    decision: text(input.decision).toLowerCase(), notes: text(input.notes) }; const errors = [];
  if (value.reviewerRole !== 'industrial_activity_reviewer') errors.push('reviewerRole must be industrial_activity_reviewer.');
  if (!['approved', 'needs_information', 'rejected'].includes(value.decision)) errors.push('decision is invalid.');
  if (!value.notes || value.notes.length > 5000) errors.push('notes are required and must not exceed 5000 characters.');
  return { value, errors };
}

module.exports = { STATUS, CAPABILITY_REGISTRY, getCapabilityRegistry, normalizeFacilityInput, validateFacilityInput,
  normalizeActivityInput, validateActivityInput, normalizeProcessInput, validateProcessInput,
  normalizeMeasurementPointInput, validateMeasurementPointInput, validateActivityReviewInput };
