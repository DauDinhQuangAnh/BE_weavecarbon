const crypto = require('crypto');
const { provision, packet, verifyPacket, calibration, health, verifyHealth, hierarchy, update, verifyUpdate,
  PROTOCOL, PROTOCOL_V2, HEALTH_PROTOCOL, UPDATE_PROTOCOL } = require('../../src/services/weavenodeControls');

const deviceId = '98765432-1234-4234-8234-123456789abc';
const pointId = '12345678-1234-4234-8234-123456789abc';
const evidenceId = '22345678-1234-4234-8234-123456789abc';
const now = new Date('2026-09-16T12:00:00.000Z');
const input = { deviceId, sequenceNumber: 1, recordedAt: '2026-09-16T10:00:00.000Z',
  periodStart: '2026-09-16T09:00:00.000Z', periodEnd: '2026-09-16T11:00:00.000Z', quantity: 42.5, unit: 'kWh' };

test('provisions Ed25519 public key only and fingerprints it', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const parsed = provision({ measurementPointRevisionId: pointId, deviceReference: 'meter-01', publicKeyPem: pem });
  expect(parsed.errors).toEqual([]);
  expect(parsed.value.protocolVersion).toBe(PROTOCOL_V2);
  expect(parsed.value.publicKeySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(provision({ measurementPointRevisionId: pointId, deviceReference: 'bad', publicKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }).errors).not.toEqual([]);
});

test('v2 packet binds source and gateway timestamps into the signature', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const unsigned = { ...input, protocol: PROTOCOL_V2, gatewayReceivedAt: '2026-09-16T10:00:05.000Z', signatureBase64: Buffer.alloc(64).toString('base64') };
  const canonical = packet(unsigned, now);
  expect(canonical.errors).toEqual([]);
  expect(canonical.payload.gatewayReceivedAt).toBe('2026-09-16T10:00:05.000Z');
  const signed = { ...unsigned, signatureBase64: crypto.sign(null, canonical.bytes, privateKey).toString('base64') };
  expect(verifyPacket(publicKey.export({ type: 'spki', format: 'pem' }), signed, now).validSignature).toBe(true);
  expect(verifyPacket(publicKey.export({ type: 'spki', format: 'pem' }), { ...signed, gatewayReceivedAt: '2026-09-16T10:00:06.000Z' }, now).validSignature).toBe(false);
});

test('health reports and update manifests are signed canonical envelopes', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const healthInput = { deviceId, sequenceNumber: 2, recordedAt: '2026-09-16T10:00:00.000Z', gatewayReceivedAt: '2026-09-16T10:00:03.000Z',
    firmwareVersion: '2.1.0', configVersion: 'site-a-7', bufferDepth: 4, storageFreeBytes: 4096,
    sensorStatus: 'warning', faultCodes: ['clock-drift'], signatureBase64: Buffer.alloc(64).toString('base64') };
  const healthEnvelope = health(healthInput, now);
  expect(healthEnvelope.bytes.toString().startsWith(`${HEALTH_PROTOCOL}\n`)).toBe(true);
  healthInput.signatureBase64 = crypto.sign(null, healthEnvelope.bytes, privateKey).toString('base64');
  expect(verifyHealth(pem, healthInput, now).validSignature).toBe(true);

  const updateInput = { deviceId, updateReference: 'firmware-2.1', updateKind: 'firmware', targetVersion: '2.1.0', rolloutStage: 'staged',
    artifactSha256: 'a'.repeat(64), signingKeyId: evidenceId, manifest: { size: 42, channel: 'stable' },
    signatureBase64: Buffer.alloc(64).toString('base64'), reason: 'security release' };
  const updateEnvelope = update(updateInput);
  expect(updateEnvelope.bytes.toString().startsWith(`${UPDATE_PROTOCOL}\n`)).toBe(true);
  updateInput.signatureBase64 = crypto.sign(null, updateEnvelope.bytes, privateKey).toString('base64');
  expect(verifyUpdate(pem, updateInput).validSignature).toBe(true);
  expect(verifyUpdate(pem, { ...updateInput, targetVersion: '2.1.1' }).validSignature).toBe(false);
});

test('meter hierarchy requires different parent and child points', () => {
  const valid = { hierarchyReference: 'plant-main', facilityRevisionId: pointId,
    parentMeasurementPointRevisionId: pointId, childMeasurementPointRevisionId: evidenceId,
    relationKind: 'sub_meter', tolerancePercent: 2, effectiveFrom: '2026-01-01T00:00:00Z', evidenceDocumentId: deviceId };
  expect(hierarchy(valid).errors).toEqual([]);
  expect(hierarchy({ ...valid, childMeasurementPointRevisionId: pointId }).errors).toContain('Parent and child measurement points must differ.');
});

test('verifies canonical signed packet and detects tampering', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const unsigned = { ...input, signatureBase64: Buffer.alloc(64).toString('base64') };
  const canonical = packet(unsigned, now);
  expect(canonical.errors).toEqual([]);
  expect(canonical.bytes.toString()).toBe(`${PROTOCOL}\n${JSON.stringify(canonical.payload)}`);
  const signed = { ...input, signatureBase64: crypto.sign(null, canonical.bytes, privateKey).toString('base64') };
  expect(verifyPacket(publicKey.export({ type: 'spki', format: 'pem' }), signed, now).validSignature).toBe(true);
  expect(verifyPacket(publicKey.export({ type: 'spki', format: 'pem' }), { ...signed, quantity: 43 }, now).validSignature).toBe(false);
});

test('rejects malformed time, signature, negative quantity and old buffer', () => {
  const signatureBase64 = Buffer.alloc(64).toString('base64');
  expect(packet({ ...input, recordedAt: 'broken', signatureBase64 }, now).errors.length).toBeGreaterThan(0);
  expect(packet({ ...input, periodEnd: '2025-01-01T11:00:00Z', signatureBase64 }, now).errors.length).toBeGreaterThan(0);
  expect(packet({ ...input, quantity: -1, signatureBase64 }, now).errors.length).toBeGreaterThan(0);
  expect(packet({ ...input, quantity: 0.000000001, signatureBase64 }, now).errors.length).toBeGreaterThan(0);
  expect(packet({ ...input, signatureBase64: 'abc' }, now).errors.length).toBeGreaterThan(0);
});

test('calibration requires evidence and valid interval', () => {
  expect(calibration({ validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z', evidenceDocumentId: evidenceId, notes: 'bench certificate' }).errors).toEqual([]);
  expect(calibration({ validFrom: '2027-01-01T00:00:00Z', validTo: '2026-01-01T00:00:00Z', evidenceDocumentId: evidenceId, notes: 'invalid' }).errors.length).toBeGreaterThan(0);
});
