const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROTOCOL = 'weavenode-ed25519-v1';
const PROTOCOL_V2 = 'weavenode-ed25519-v2';
const HEALTH_PROTOCOL = 'weavenode-health-ed25519-v1';
const UPDATE_PROTOCOL = 'weavenode-update-ed25519-v1';
const MAX_PACKET_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const text = (value) => String(value ?? '').trim();
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  return value;
}
const stableJson = (value) => JSON.stringify(stable(value));
function provision(input = {}) {
  const value = { measurementPointRevisionId: text(input.measurementPointRevisionId), deviceReference: text(input.deviceReference),
    publicKeyPem: text(input.publicKeyPem), protocolVersion: text(input.protocolVersion) || PROTOCOL_V2 };
  const errors = [];
  if (!UUID.test(value.measurementPointRevisionId)) errors.push('measurementPointRevisionId must be a UUID.');
  if (!value.deviceReference || value.deviceReference.length > 120) errors.push('deviceReference is required.');
  if (![PROTOCOL, PROTOCOL_V2].includes(value.protocolVersion)) errors.push('protocolVersion is invalid.');
  if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(value.publicKeyPem)) errors.push('publicKeyPem must contain a public key, never a private key.');
  try {
    const key = crypto.createPublicKey(value.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') errors.push('publicKeyPem must be an Ed25519 public key.');
    else value.publicKeySha256 = sha(key.export({ format: 'der', type: 'spki' }));
  } catch { errors.push('publicKeyPem must be a valid Ed25519 public key.'); }
  return { value, errors };
}
function packet(input = {}, now = new Date()) {
  const value = { protocol: text(input.protocol) || PROTOCOL, deviceId: text(input.deviceId), sequenceNumber: Number(input.sequenceNumber), recordedAt: text(input.recordedAt),
    gatewayReceivedAt: text(input.gatewayReceivedAt), periodStart: text(input.periodStart), periodEnd: text(input.periodEnd), quantity: Number(input.quantity), unit: text(input.unit), signatureBase64: text(input.signatureBase64) };
  const errors = [];
  if (![PROTOCOL, PROTOCOL_V2].includes(value.protocol)) errors.push('protocol is invalid.');
  if (!UUID.test(value.deviceId)) errors.push('deviceId must be a UUID.');
  if (typeof input.sequenceNumber !== 'number' || !Number.isSafeInteger(value.sequenceNumber) || value.sequenceNumber <= 0) errors.push('sequenceNumber must be a positive safe integer.');
  const timestamps = [value.recordedAt, value.periodStart, value.periodEnd].map((item) => new Date(item));
  if (timestamps.some((date, index) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test([value.recordedAt, value.periodStart, value.periodEnd][index]) || Number.isNaN(date.getTime()))) errors.push('Packet timestamps must be valid ISO date-times.');
  else if (timestamps[1] > timestamps[2] || timestamps[0] < timestamps[1] || timestamps[0] > timestamps[2] || timestamps[2].getTime() > now.getTime() + FUTURE_TOLERANCE_MS || timestamps[2].getTime() < now.getTime() - MAX_PACKET_AGE_MS) errors.push('Packet time window is invalid or outside the 90-day buffer window.');
  let gatewayReceivedAt = null;
  if (value.protocol === PROTOCOL_V2) {
    gatewayReceivedAt = new Date(value.gatewayReceivedAt);
    if (!value.gatewayReceivedAt || Number.isNaN(gatewayReceivedAt.getTime()) || gatewayReceivedAt < timestamps[0]
      || gatewayReceivedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) errors.push('gatewayReceivedAt must be a valid gateway timestamp at or after recordedAt.');
  }
  if (typeof input.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity < 0 || value.quantity > 1e12) errors.push('quantity must be between zero and one trillion.');
  else if (Number(value.quantity.toFixed(8)) !== value.quantity) errors.push('quantity must have at most eight decimal places.');
  if (!value.unit || value.unit.length > 100) errors.push('unit is required.');
  const signatureBytes = Buffer.from(value.signatureBase64, 'base64');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== value.signatureBase64) errors.push('signatureBase64 must encode a 64-byte Ed25519 signature.');
  if (errors.length) return { value, payload: null, bytes: null, errors };
  const payload = value.protocol === PROTOCOL_V2
    ? { protocol: PROTOCOL_V2, deviceId: value.deviceId, sequenceNumber: value.sequenceNumber, recordedAt: timestamps[0].toISOString(),
      gatewayReceivedAt: gatewayReceivedAt.toISOString(), periodStart: timestamps[1].toISOString(), periodEnd: timestamps[2].toISOString(), quantity: value.quantity, unit: value.unit }
    : { protocol: PROTOCOL, deviceId: value.deviceId, sequenceNumber: value.sequenceNumber, recordedAt: timestamps[0].toISOString(),
      periodStart: timestamps[1].toISOString(), periodEnd: timestamps[2].toISOString(), quantity: value.quantity, unit: value.unit };
  return { value, payload, bytes: Buffer.from(`${value.protocol}\n${JSON.stringify(payload)}`, 'utf8'), errors };
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

function health(input = {}, now = new Date()) {
  const value = { deviceId: text(input.deviceId), sequenceNumber: Number(input.sequenceNumber), recordedAt: text(input.recordedAt),
    gatewayReceivedAt: text(input.gatewayReceivedAt), firmwareVersion: text(input.firmwareVersion), configVersion: text(input.configVersion),
    bufferDepth: Number(input.bufferDepth), storageFreeBytes: Number(input.storageFreeBytes), sensorStatus: text(input.sensorStatus).toLowerCase(),
    faultCodes: Array.isArray(input.faultCodes) ? input.faultCodes.map(text).filter(Boolean) : [], signatureBase64: text(input.signatureBase64) };
  const errors = [];
  if (!UUID.test(value.deviceId)) errors.push('deviceId must be a UUID.');
  if (!Number.isSafeInteger(value.sequenceNumber) || value.sequenceNumber <= 0) errors.push('sequenceNumber must be a positive safe integer.');
  const source = new Date(value.recordedAt), gateway = new Date(value.gatewayReceivedAt);
  if (Number.isNaN(source.getTime()) || Number.isNaN(gateway.getTime()) || gateway < source || gateway.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) errors.push('Health timestamps are invalid.');
  if (!value.firmwareVersion || value.firmwareVersion.length > 120 || !value.configVersion || value.configVersion.length > 120) errors.push('Firmware and configuration versions are required.');
  if (!Number.isSafeInteger(value.bufferDepth) || value.bufferDepth < 0 || !Number.isSafeInteger(value.storageFreeBytes) || value.storageFreeBytes < 0) errors.push('Health counters must be nonnegative safe integers.');
  if (!['ok', 'warning', 'fault'].includes(value.sensorStatus)) errors.push('sensorStatus is invalid.');
  if (value.faultCodes.length > 100 || value.faultCodes.some((item) => item.length > 120)) errors.push('faultCodes are invalid.');
  const signatureBytes = Buffer.from(value.signatureBase64, 'base64');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== value.signatureBase64) errors.push('signatureBase64 must encode a 64-byte Ed25519 signature.');
  if (errors.length) return { value, payload: null, bytes: null, errors };
  const payload = { protocol: HEALTH_PROTOCOL, deviceId: value.deviceId, sequenceNumber: value.sequenceNumber,
    recordedAt: source.toISOString(), gatewayReceivedAt: gateway.toISOString(), firmwareVersion: value.firmwareVersion,
    configVersion: value.configVersion, bufferDepth: value.bufferDepth, storageFreeBytes: value.storageFreeBytes,
    sensorStatus: value.sensorStatus, faultCodes: value.faultCodes };
  return { value, payload, bytes: Buffer.from(`${HEALTH_PROTOCOL}\n${JSON.stringify(payload)}`, 'utf8'), errors };
}

function verifyHealth(publicKeyPem, input, now = new Date()) {
  const parsed = health(input, now); if (parsed.errors.length) return { ...parsed, validSignature: false };
  let validSignature = false;
  try { validSignature = crypto.verify(null, parsed.bytes, crypto.createPublicKey(publicKeyPem), Buffer.from(parsed.value.signatureBase64, 'base64')); } catch { validSignature = false; }
  return { ...parsed, validSignature, payloadSha256: sha(parsed.bytes) };
}

function hierarchy(input = {}) {
  const tolerance = Number(input.tolerancePercent);
  const value = { hierarchyReference: text(input.hierarchyReference), facilityRevisionId: text(input.facilityRevisionId),
    parentMeasurementPointRevisionId: text(input.parentMeasurementPointRevisionId), childMeasurementPointRevisionId: text(input.childMeasurementPointRevisionId),
    relationKind: text(input.relationKind).toLowerCase(), tolerancePercent: tolerance,
    effectiveFrom: text(input.effectiveFrom), effectiveTo: text(input.effectiveTo) || null,
    evidenceDocumentId: text(input.evidenceDocumentId) };
  const errors = [];
  if (!value.hierarchyReference || value.hierarchyReference.length > 120) errors.push('hierarchyReference is required.');
  for (const field of ['facilityRevisionId', 'parentMeasurementPointRevisionId', 'childMeasurementPointRevisionId', 'evidenceDocumentId']) if (!UUID.test(value[field])) errors.push(`${field} must be a UUID.`);
  if (value.parentMeasurementPointRevisionId === value.childMeasurementPointRevisionId) errors.push('Parent and child measurement points must differ.');
  if (!['sub_meter', 'line_meter', 'machine_meter'].includes(value.relationKind)) errors.push('relationKind is invalid.');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) errors.push('tolerancePercent must be between 0 and 100.');
  const from = new Date(value.effectiveFrom), to = value.effectiveTo ? new Date(value.effectiveTo) : null;
  if (Number.isNaN(from.getTime()) || (to && (Number.isNaN(to.getTime()) || to <= from))) errors.push('Hierarchy effective interval is invalid.');
  return { value, errors };
}

function reconciliation(input = {}) {
  const value = { parentMeasurementPointRevisionId: text(input.parentMeasurementPointRevisionId),
    periodStart: text(input.periodStart), periodEnd: text(input.periodEnd) };
  const errors = [];
  if (!UUID.test(value.parentMeasurementPointRevisionId)) errors.push('parentMeasurementPointRevisionId must be a UUID.');
  const start = new Date(value.periodStart), end = new Date(value.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) errors.push('A valid reconciliation period is required.');
  return { value, errors };
}

function releaseKey(input = {}) {
  const value = { keyReference: text(input.keyReference), publicKeyPem: text(input.publicKeyPem) }; const errors = [];
  if (!value.keyReference || value.keyReference.length > 120) errors.push('keyReference is required.');
  try { const key = crypto.createPublicKey(value.publicKeyPem); if (key.asymmetricKeyType !== 'ed25519') errors.push('Release key must be Ed25519.');
    else value.publicKeySha256 = sha(key.export({ format: 'der', type: 'spki' })); } catch { errors.push('publicKeyPem must be a valid Ed25519 public key.'); }
  return { value, errors };
}

function update(input = {}) {
  const value = { deviceId: text(input.deviceId), updateReference: text(input.updateReference), updateKind: text(input.updateKind).toLowerCase(),
    targetVersion: text(input.targetVersion), rolloutStage: text(input.rolloutStage).toLowerCase(), artifactSha256: text(input.artifactSha256).toLowerCase(),
    signingKeyId: text(input.signingKeyId), manifest: input.manifest && typeof input.manifest === 'object' && !Array.isArray(input.manifest) ? input.manifest : {},
    signatureBase64: text(input.signatureBase64), rollbackOfUpdateId: text(input.rollbackOfUpdateId) || null, reason: text(input.reason) };
  const errors = [];
  if (!UUID.test(value.deviceId) || !UUID.test(value.signingKeyId)) errors.push('Device and signing key UUIDs are required.');
  if (!value.updateReference || value.updateReference.length > 120 || !value.targetVersion || value.targetVersion.length > 120) errors.push('Update reference and target version are required.');
  if (!['firmware', 'configuration'].includes(value.updateKind) || !['staged', 'canary', 'production', 'rollback'].includes(value.rolloutStage)) errors.push('Update kind or rollout stage is invalid.');
  if (!/^[a-f0-9]{64}$/.test(value.artifactSha256)) errors.push('artifactSha256 must be a SHA-256 digest.');
  if (value.rolloutStage === 'rollback' ? !UUID.test(value.rollbackOfUpdateId || '') : Boolean(value.rollbackOfUpdateId)) errors.push('rollbackOfUpdateId is required only for rollback.');
  if (!value.reason || value.reason.length > 2000) errors.push('reason is required.');
  const signatureBytes = Buffer.from(value.signatureBase64, 'base64');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== value.signatureBase64) errors.push('signatureBase64 must encode a 64-byte Ed25519 signature.');
  const payload = { protocol: UPDATE_PROTOCOL, deviceId: value.deviceId, updateReference: value.updateReference,
    updateKind: value.updateKind, targetVersion: value.targetVersion, rolloutStage: value.rolloutStage,
    artifactSha256: value.artifactSha256, signingKeyId: value.signingKeyId, rollbackOfUpdateId: value.rollbackOfUpdateId, manifest: stable(value.manifest) };
  return { value, payload, bytes: Buffer.from(`${UPDATE_PROTOCOL}\n${stableJson(payload)}`, 'utf8'), errors };
}

function verifyUpdate(publicKeyPem, input) {
  const parsed = update(input); if (parsed.errors.length) return { ...parsed, validSignature: false };
  let validSignature = false;
  try { validSignature = crypto.verify(null, parsed.bytes, crypto.createPublicKey(publicKeyPem), Buffer.from(parsed.value.signatureBase64, 'base64')); } catch { validSignature = false; }
  return { ...parsed, validSignature, manifestSha256: sha(parsed.bytes) };
}

module.exports = { PROTOCOL, PROTOCOL_V2, HEALTH_PROTOCOL, UPDATE_PROTOCOL, provision, packet, verifyPacket, calibration,
  health, verifyHealth, hierarchy, reconciliation, releaseKey, update, verifyUpdate, sha, stableJson };
