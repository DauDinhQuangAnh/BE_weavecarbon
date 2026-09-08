const crypto = require('crypto');
const JSZip = require('jszip');
const { canonicalize, stableCanonicalJson } = require('../carbon/calculationSnapshot');

const CONTRIBUTION_SCHEMA = 'carbon-contribution-terms-v1';

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
      reportingPeriodEnd: item.reporting_period_end || null
    };
  });
  const carbonResults = snapshot.payload.carbonResults || snapshot.payload.carbon_results;
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
    evidence
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
  buildAuditBundleArchive,
  safeFilename,
  sha256
};
