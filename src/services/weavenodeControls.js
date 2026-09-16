const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROTOCOL = 'weavenode-ed25519-v1';
const MAX_PACKET_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const text = (value) => String(value ?? '').trim();
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function provision(input = {}) {
  const value = { measurementPointRevisionId: text(input.measurementPointRevisionId), deviceReference: text(input.deviceReference), publicKeyPem: text(input.publicKeyPem) };
  const errors = [];
  if (!UUID.test(value.measurementPointRevisionId)) errors.push('measurementPointRevisionId must be a UUID.');
  if (!value.deviceReference || value.deviceReference.length > 120) errors.push('deviceReference is required.');
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(value.publicKeyPem)) errors.push('publicKeyPem must contain a public key, never a private key.');
  try {
    const key = crypto.createPublicKey(value.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') errors.push('publicKeyPem must be an Ed25519 public key.');
    else value.publicKeySha256 = sha(key.export({ format: 'der', type: 'spki' }));
  } catch { errors.push('publicKeyPem must be a valid Ed25519 public key.'); }
  return { value, errors };
}
function packet(input = {}, now = new Date()) {
  const value = { deviceId: text(input.deviceId), sequenceNumber: Number(input.sequenceNumber), recordedAt: text(input.recordedAt),
    periodStart: text(input.periodStart), periodEnd: text(input.periodEnd), quantity: Number(input.quantity), unit: text(input.unit), signatureBase64: text(input.signatureBase64) };
  const errors = [];
  if (!UUID.test(value.deviceId)) errors.push('deviceId must be a UUID.');
  if (typeof input.sequenceNumber !== 'number' || !Number.isSafeInteger(value.sequenceNumber) || value.sequenceNumber <= 0) errors.push('sequenceNumber must be a positive safe integer.');
  const timestamps = [value.recordedAt, value.periodStart, value.periodEnd].map((item) => new Date(item));
  if (timestamps.some((date, index) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test([value.recordedAt, value.periodStart, value.periodEnd][index]) || Number.isNaN(date.getTime()))) errors.push('Packet timestamps must be valid ISO date-times.');
  else if (timestamps[1] > timestamps[2] || timestamps[0] < timestamps[1] || timestamps[0] > timestamps[2] || timestamps[2].getTime() > now.getTime() + FUTURE_TOLERANCE_MS || timestamps[2].getTime() < now.getTime() - MAX_PACKET_AGE_MS) errors.push('Packet time window is invalid or outside the 90-day buffer window.');
  if (typeof input.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity < 0 || value.quantity > 1e12) errors.push('quantity must be between zero and one trillion.');
  else if (Number(value.quantity.toFixed(8)) !== value.quantity) errors.push('quantity must have at most eight decimal places.');
  if (!value.unit || value.unit.length > 100) errors.push('unit is required.');
  const signatureBytes = Buffer.from(value.signatureBase64, 'base64');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== value.signatureBase64) errors.push('signatureBase64 must encode a 64-byte Ed25519 signature.');
  if (errors.length) return { value, payload: null, bytes: null, errors };
  const payload = { protocol: PROTOCOL, deviceId: value.deviceId, sequenceNumber: value.sequenceNumber, recordedAt: timestamps[0].toISOString(),
    periodStart: timestamps[1].toISOString(), periodEnd: timestamps[2].toISOString(), quantity: value.quantity, unit: value.unit };
  return { value, payload, bytes: Buffer.from(`${PROTOCOL}\n${JSON.stringify(payload)}`, 'utf8'), errors };
}
function verifyPacket(publicKeyPem, input, now = new Date()) {
  const parsed = packet(input, now); if (parsed.errors.length) return { ...parsed, validSignature: false };
  let validSignature = false;
  try { validSignature = crypto.verify(null, parsed.bytes, crypto.createPublicKey(publicKeyPem), Buffer.from(parsed.value.signatureBase64, 'base64')); } catch { validSignature = false; }
  return { ...parsed, validSignature, payloadSha256: sha(parsed.bytes) };
}
function calibration(input = {}) {
  const value = { validFrom: text(input.validFrom), validTo: text(input.validTo), evidenceDocumentId: text(input.evidenceDocumentId), notes: text(input.notes) };
  const errors = [];
  const from = new Date(value.validFrom), to = new Date(value.validTo);
  if (!value.validFrom || !value.validTo || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) errors.push('Calibration validity interval is required.');
  if (!UUID.test(value.evidenceDocumentId)) errors.push('evidenceDocumentId must be a UUID.');
  if (!value.notes || value.notes.length > 2000) errors.push('notes are required.');
  return { value, errors };
}
module.exports = { PROTOCOL, provision, packet, verifyPacket, calibration, sha };
