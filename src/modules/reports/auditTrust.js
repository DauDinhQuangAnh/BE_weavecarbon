const crypto = require('crypto');
const { stableCanonicalJson } = require('../carbon/calculationSnapshot');

const ISSUANCE_SIGNATURE_ALGORITHM = 'ed25519-weavecarbon-attestation-v1';
const AUDIT_SHARE_TOKEN_BYTES = 32;
const ASSURED_OUTCOMES = new Set([
  'limited_assurance',
  'reasonable_assurance',
  'qualified',
  'adverse'
]);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function createAuditIssuanceSignature({
  companyId,
  auditBundleId,
  manifestSha256,
  bundleSha256,
  assertion,
  criteria,
  signerId,
  signerName,
  signerEmail,
  signedAt
}) {
  const signaturePayload = {
    schemaVersion: 'weavecarbon-audit-issuance-signature-v1',
    companyId,
    auditBundleId,
    manifestSha256: String(manifestSha256 || '').toLowerCase(),
    bundleSha256: String(bundleSha256 || '').toLowerCase(),
    assertion,
    criteria,
    signer: {
      id: signerId,
      name: signerName,
      email: signerEmail
    },
    signedAt
  };
  const canonicalPayload = stableCanonicalJson(signaturePayload);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    signatureAlgorithm: ISSUANCE_SIGNATURE_ALGORITHM,
    signaturePayload,
    signaturePayloadSha256: sha256(canonicalPayload),
    signaturePublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    signatureValue: crypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKey).toString('base64'),
    signedAt
  };
}

function verifyAuditIssuanceSignature(value = {}) {
  try {
    const algorithm = value.signatureAlgorithm || value.signature_algorithm;
    const payload = value.signaturePayload || value.signature_payload;
    const payloadSha256 = value.signaturePayloadSha256 || value.signature_payload_sha256;
    const publicKey = value.signaturePublicKey || value.signature_public_key;
    const signatureValue = value.signatureValue || value.signature_value;
    if (algorithm !== ISSUANCE_SIGNATURE_ALGORITHM || !payload || !publicKey || !signatureValue) return false;
    const canonicalPayload = stableCanonicalJson(payload);
    if (sha256(canonicalPayload) !== String(payloadSha256 || '').toLowerCase()) return false;
    const expectedBindings = {
      companyId: value.companyId || value.company_id,
      auditBundleId: value.auditBundleId || value.audit_bundle_id || (value.issuance_id ? value.id : undefined),
      manifestSha256: value.manifestSha256 || value.manifest_sha256,
      bundleSha256: value.bundleSha256 || value.bundle_sha256,
      assertion: value.assertion || value.assertion_text,
      criteria: value.criteria,
      signerId: value.signerId || value.issued_by,
      signerName: value.signerName || value.signer_name_snapshot,
      signerEmail: value.signerEmail || value.signer_email_snapshot
    };
    const payloadBindings = {
      companyId: payload.companyId,
      auditBundleId: payload.auditBundleId,
      manifestSha256: payload.manifestSha256,
      bundleSha256: payload.bundleSha256,
      assertion: payload.assertion,
      criteria: payload.criteria,
      signerId: payload.signer?.id,
      signerName: payload.signer?.name,
      signerEmail: payload.signer?.email
    };
    if (Object.entries(expectedBindings).some(([key, expected]) => (
      expected !== undefined && expected !== null && String(payloadBindings[key]) !== String(expected)
    ))) return false;
    return crypto.verify(
      null,
      Buffer.from(canonicalPayload, 'utf8'),
      crypto.createPublicKey(publicKey),
      Buffer.from(signatureValue, 'base64')
    );
  } catch {
    return false;
  }
}

function createAuditShareToken() {
  const token = crypto.randomBytes(AUDIT_SHARE_TOKEN_BYTES).toString('base64url');
  return { token, tokenSha256: sha256(token) };
}

function normalizeAuditShareToken(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function deriveExternalAssuranceStatus(record) {
  const outcome = String(record?.outcome || record?.assurance_outcome || '').trim().toLowerCase();
  if (!outcome || ['requested', 'evidence_received'].includes(outcome)) return 'not_verified';
  if (outcome === 'withdrawn') return 'withdrawn';
  const validTo = record?.validTo || record?.valid_to || record?.assurance_valid_to;
  if (validTo && String(validTo).slice(0, 10) < new Date().toISOString().slice(0, 10)) return 'expired';
  return ASSURED_OUTCOMES.has(outcome) ? outcome : 'not_verified';
}

module.exports = {
  ASSURED_OUTCOMES,
  AUDIT_SHARE_TOKEN_BYTES,
  ISSUANCE_SIGNATURE_ALGORITHM,
  createAuditIssuanceSignature,
  createAuditShareToken,
  deriveExternalAssuranceStatus,
  normalizeAuditShareToken,
  sha256,
  verifyAuditIssuanceSignature
};
