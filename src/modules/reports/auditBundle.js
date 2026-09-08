const crypto = require('crypto');
const JSZip = require('jszip');
const { canonicalize, stableCanonicalJson } = require('../carbon/calculationSnapshot');

const CONTRIBUTION_SCHEMA = 'carbon-contribution-terms-v1';

const ACTIVITY_EVIDENCE_TYPES = Object.freeze({
  materials: [
    'bill_of_materials', 'bom', 'material_invoice', 'material_certificate', 'supplier_certificate',
    'supplier_declaration', 'pcf_source'
  ],
  packaging: ['packaging_specification', 'packaging_invoice', 'packaging_certificate', 'pcf_source'],
  finished_goods_manufacturing: [
    'electricity_bill', 'electricity_invoice', 'energy_invoice', 'fuel_invoice', 'fuel_receipt', 'meter_reading',
    'production_record', 'utility_bill', 'pcf_source'
  ],
  logistics_and_storage: [
    'air_waybill', 'airway_bill', 'bill_of_lading', 'carrier_document', 'cmr', 'freight_invoice',
    'logistics_invoice', 'transport_document', 'pcf_source'
  ]
});
const FACTOR_EVIDENCE_TYPES = new Set([
  'emission_factor', 'emission_factor_source', 'factor_source', 'methodology', 'pcf_source'
]);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const safeFilename = (value, fallback) => {
  const name = String(value || fallback || 'evidence.bin')
    .split('')
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return name || fallback || 'evidence.bin';
};

const normalizeEvidenceType = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const hasDeclaredPeriod = (item) => {
  if (!item.reporting_period_start || !item.reporting_period_end) return false;
  const start = Date.parse(item.reporting_period_start);
  const end = Date.parse(item.reporting_period_end);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end;
};

const normalizeFactorVersionIds = (value) => {
  const parsed = typeof value === 'string' ? (() => {
    try { return JSON.parse(value); } catch { return [value]; }
  })() : value;
  return [...new Set((Array.isArray(parsed) ? parsed : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))].sort();
};

const normalizeCalculationTermNumbers = (value) => {
  const parsed = typeof value === 'string' ? (() => {
    try { return JSON.parse(value); } catch { return String(value).split(/[\n,]/); }
  })() : value;
  return [...new Set((Array.isArray(parsed) ? parsed : [])
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0))].sort((a, b) => a - b);
};

const buildTermKey = (term, index) => sha256(stableCanonicalJson({
  index,
  stage: term.stage || null,
  detail: term.detail || null,
  activity: term.activity,
  activityUnit: term.activityUnit,
  factorVersionId: term.factorVersionId,
  kgCo2e: term.kgCo2e
}));

const buildTermEvidenceCoverage = (calculationTerms, evidence) => {
  const normalizedEvidence = evidence.map((item) => ({
    ...item,
    normalizedType: normalizeEvidenceType(item.evidenceType || item.evidence_type),
    factorVersionIds: normalizeFactorVersionIds(item.factorVersionIds || item.factor_version_ids),
    calculationTermNumbers: normalizeCalculationTermNumbers(
      item.calculationTermNumbers || item.calculation_term_numbers
    ),
    hasDeclaredPeriod: hasDeclaredPeriod({
      reporting_period_start: item.reportingPeriodStart || item.reporting_period_start,
      reporting_period_end: item.reportingPeriodEnd || item.reporting_period_end
    })
  }));
  const terms = calculationTerms.map((term, index) => {
    const acceptedActivityTypes = ACTIVITY_EVIDENCE_TYPES[term.stage] || [];
    const stageCandidates = normalizedEvidence.filter((item) =>
      acceptedActivityTypes.includes(item.normalizedType)
    );
    const activityCandidates = stageCandidates.filter((item) => item.calculationTermNumbers.includes(index + 1));
    const activityEvidence = activityCandidates.filter((item) => item.hasDeclaredPeriod);
    const factorTypeCandidates = normalizedEvidence.filter((item) => FACTOR_EVIDENCE_TYPES.has(item.normalizedType));
    const factorCandidates = factorTypeCandidates.filter((item) => item.factorVersionIds.includes(term.factorVersionId));
    const factorEvidence = factorCandidates.filter((item) => item.hasDeclaredPeriod);
    const missing = [];
    if (activityEvidence.length === 0) {
      missing.push(activityCandidates.length
        ? 'activity_evidence_period'
        : (stageCandidates.length ? 'activity_evidence_term_mapping' : 'activity_evidence'));
    }
    if (factorEvidence.length === 0) {
      missing.push(factorCandidates.length
        ? 'factor_evidence_period'
        : (factorTypeCandidates.length ? 'factor_evidence_version_mapping' : 'factor_evidence'));
    }
    return {
      termKey: buildTermKey(term, index),
      termIndex: index,
      stage: term.stage,
      detail: term.detail,
      factorVersionId: term.factorVersionId,
      activityEvidenceDocumentIds: activityEvidence.map((item) => item.evidenceDocumentId || item.evidence_document_id),
      factorEvidenceDocumentIds: factorEvidence.map((item) => item.evidenceDocumentId || item.evidence_document_id),
      missing,
      status: missing.length === 0 ? 'covered' : 'incomplete'
    };
  });
  const coveredTerms = terms.filter((term) => term.status === 'covered').length;
  return {
    schemaVersion: 'audit-term-evidence-coverage-v1',
    status: terms.length > 0 && coveredTerms === terms.length ? 'complete' : 'incomplete',
    termCount: terms.length,
    coveredTermCount: coveredTerms,
    missingTermCount: terms.length - coveredTerms,
    rules: {
      activityEvidenceTypesByStage: ACTIVITY_EVIDENCE_TYPES,
      factorEvidenceTypes: [...FACTOR_EVIDENCE_TYPES].sort(),
      explicitCalculationTermNumberRequired: true,
      reportingPeriodRequired: true
    },
    terms
  };
};

const assertBundleInputs = ({ snapshot, evidenceFiles }) => {
  const result = snapshot?.payload?.carbonResults || snapshot?.payload?.carbon_results;
  if (!result || result.calculationTermsSchemaVersion !== CONTRIBUTION_SCHEMA) {
    const error = new Error('The selected calculation has no authoritative contribution terms. Recalculate the product first.');
    error.code = 'AUDIT_CALCULATION_TERMS_REQUIRED';
    throw error;
  }
  if (!Array.isArray(result.calculationTerms) || result.calculationTerms.length === 0) {
    const error = new Error('The selected calculation has no contribution rows.');
    error.code = 'AUDIT_CALCULATION_TERMS_REQUIRED';
    throw error;
  }
  if (!Array.isArray(evidenceFiles) || evidenceFiles.length === 0) {
    const error = new Error('At least one locked evidence file with SHA-256 is required.');
    error.code = 'AUDIT_EVIDENCE_REQUIRED';
    throw error;
  }
};

async function buildAuditBundleArchive({ bundle, product, snapshot, evidenceFiles, createdAt }) {
  assertBundleInputs({ snapshot, evidenceFiles });
  const timestamp = new Date(createdAt || bundle.created_at || Date.now()).toISOString();
  const evidence = evidenceFiles.map((item) => {
    const actualSha256 = sha256(item.buffer);
    if (!/^[a-f0-9]{64}$/i.test(item.checksum_sha256 || '') || actualSha256 !== item.checksum_sha256.toLowerCase()) {
      const error = new Error(`Evidence checksum mismatch: ${item.evidence_document_id}`);
      error.code = 'AUDIT_EVIDENCE_CHECKSUM_MISMATCH';
      throw error;
    }
    if (Number(item.file_size_bytes) !== item.buffer.length) {
      const error = new Error(`Evidence size mismatch: ${item.evidence_document_id}`);
      error.code = 'AUDIT_EVIDENCE_SIZE_MISMATCH';
      throw error;
    }
    return {
      evidenceDocumentId: item.evidence_document_id,
      evidenceType: item.evidence_type,
      filename: safeFilename(item.original_filename, `${item.evidence_document_id}.bin`),
      mimeType: item.mime_type || 'application/octet-stream',
      fileSizeBytes: item.buffer.length,
      sha256: actualSha256,
      reportingPeriodStart: item.reporting_period_start || null,
      reportingPeriodEnd: item.reporting_period_end || null,
      factorVersionIds: normalizeFactorVersionIds(item.factor_version_ids),
      calculationTermNumbers: normalizeCalculationTermNumbers(item.calculation_term_numbers)
    };
  });
  const carbonResults = snapshot.payload.carbonResults || snapshot.payload.carbon_results;
  const termEvidenceCoverage = buildTermEvidenceCoverage(carbonResults.calculationTerms, evidence);
  const manifestCore = canonicalize({
    schemaVersion: 'weavecarbon-audit-bundle-v1',
    bundleId: bundle.id,
    bundleVersion: Number(bundle.version),
    status: 'internal_review',
    assuranceStatus: 'not_verified',
    createdAt: timestamp,
    companyId: bundle.company_id,
    product: { id: product.id, sku: product.sku, name: product.name },
    calculation: {
      snapshotId: snapshot.id,
      version: Number(snapshot.version),
      calculatedAt: snapshot.calculated_at,
      engineVersion: snapshot.engine_version,
      methodologyVersion: snapshot.methodology_version,
      factorRegistryVersion: snapshot.factor_registry_version,
      gwpBasis: snapshot.gwp_basis,
      canonicalInputHash: snapshot.canonical_input_hash,
      contributionTermsSchemaVersion: carbonResults.calculationTermsSchemaVersion,
      contributionTermCount: carbonResults.calculationTerms.length
    },
    evidence,
    termEvidenceCoverage
  });
  const manifestSha256 = sha256(stableCanonicalJson(manifestCore));
  const manifest = { ...manifestCore, manifestSha256 };
  const zip = new JSZip();
  const zipOptions = { date: new Date(timestamp), createFolders: false };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), zipOptions);
  zip.file('calculation.json', JSON.stringify(canonicalize(snapshot.payload), null, 2), zipOptions);
  zip.file('evidence/index.json', JSON.stringify(evidence, null, 2), zipOptions);
  evidenceFiles.forEach((item, index) => {
    zip.file(
      `evidence/${item.evidence_document_id}/${evidence[index].filename}`,
      item.buffer,
      zipOptions
    );
  });
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, manifest, manifestSha256, bundleSha256: sha256(buffer) };
}

module.exports = {
  CONTRIBUTION_SCHEMA,
  assertBundleInputs,
  buildTermEvidenceCoverage,
  buildAuditBundleArchive,
  buildTermKey,
  hasDeclaredPeriod,
  normalizeEvidenceType,
  normalizeFactorVersionIds,
  normalizeCalculationTermNumbers,
  safeFilename,
  sha256
};
