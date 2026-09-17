const crypto = require('crypto');
const { WeavenodeService } = require('../../src/services/weavenodeService');
const { packet, health } = require('../../src/services/weavenodeControls');

const deviceId = '98765432-1234-4234-8234-123456789abc';
const companyId = '12345678-1234-4234-8234-123456789abc';
const userId = '22345678-1234-4234-8234-123456789abc';
const now = new Date('2026-09-16T12:00:00.000Z');
const base = { deviceId, sequenceNumber: 1, recordedAt: '2026-09-16T10:00:00.000Z',
  periodStart: '2026-09-16T09:00:00.000Z', periodEnd: '2026-09-16T11:00:00.000Z', quantity: 42, unit: 'kWh' };

function signed(privateKey, overrides = {}) {
  const input = { ...base, ...overrides, signatureBase64: Buffer.alloc(64).toString('base64') };
  input.signatureBase64 = crypto.sign(null, packet(input, now).bytes, privateKey).toString('base64');
  return input;
}

test('ingest buffers valid packet, rejects wrong unit and deduplicates retransmission', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'pem' });
  const saved = new Map();
  const client = { release: jest.fn(), query: jest.fn(async (sql, params) => {
    if (sql.includes('SELECT id FROM weavenode_devices') || sql.includes('weavenode_device_events')) return { rows: [] };
    if (sql.includes('INSERT INTO weavenode_packets')) {
      if (saved.has(params[2])) return { rows: [] };
      saved.set(params[2], params[4]); return { rows: [{ id: 'packet-1' }] };
    }
    if (sql.includes('SELECT id,payload_sha256 FROM weavenode_packets')) return { rows: [{ id: 'packet-1', payload_sha256: saved.get(params[1]) }] };
    return { rows: [] };
  }) };
  const database = { connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [{ id: deviceId, company_id: companyId, public_key_pem: key, protocol_version: 'weavenode-ed25519-v1', canonical_unit: 'kWh', revoked: false }] })) };
  const service = new WeavenodeService(database);
  expect((await service.ingest(signed(privateKey), now)).status).toBe('buffered');
  expect((await service.ingest(signed(privateKey), now)).status).toBe('duplicate');
  expect((await service.ingest(signed(privateKey, { unit: 'MJ' }), now)).code).toBe('WEAVENODE_UNIT_MISMATCH');
  expect((await service.ingest(signed(privateKey, { quantity: 43 }), now)).code).toBe('WEAVENODE_SEQUENCE_CONFLICT');
  expect(client.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(3);
});

test('replay stops at sequence gap without inventing activity', async () => {
  const client = { release: jest.fn(), query: jest.fn(async (sql) => {
    if (sql.includes('FROM weavenode_devices d JOIN industrial_measurement_point_revisions')) return { rows: [{ id: deviceId, company_id: companyId, measurement_point_revision_id: 'point', facility_revision_id: 'facility', process_revision_id: null, measurement_type: 'electricity', canonical_unit: 'kWh' }] };
    if (sql.includes('MAX(sequence_number)')) return { rows: [{ value: 0 }] };
    if (sql.includes('FROM weavenode_packets WHERE')) return { rows: [{ id: 'packet-2', sequence_number: 2 }] };
    return { rows: [] };
  }) };
  const service = new WeavenodeService({ connect: async () => client });
  const result = await service.replay(companyId, userId, deviceId);
  expect(result.accepted).toEqual([]);
  expect(result.blocker).toEqual({ code: 'WEAVENODE_SEQUENCE_GAP', expectedSequence: 1 });
  expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO industrial_activity_records'))).toBe(false);
  expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
});

test('ingestHealth verifies the device signature and records dual-time health', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const input = { deviceId, sequenceNumber: 7, recordedAt: '2026-09-16T10:00:00.000Z',
    gatewayReceivedAt: '2026-09-16T10:00:04.000Z', firmwareVersion: '2.0.0', configVersion: 'plant-a-3',
    bufferDepth: 5, storageFreeBytes: 8192, sensorStatus: 'ok', faultCodes: [],
    signatureBase64: Buffer.alloc(64).toString('base64') };
  input.signatureBase64 = crypto.sign(null, health(input, now).bytes, privateKey).toString('base64');
  const database = { query: jest.fn(async (sql, params) => {
    if (sql.includes('FROM weavenode_devices d WHERE')) return { rows: [{ id: deviceId, company_id: companyId,
      public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }), revoked: false }] };
    if (sql.includes('INSERT INTO weavenode_health_reports')) {
      expect(params[5]).toBe(4);
      return { rows: [{ id: 'health-7', sequence_number: 7, server_received_at: now.toISOString() }] };
    }
    return { rows: [] };
  }) };
  const result = await new WeavenodeService(database).ingestHealth(input, now);
  expect(result).toMatchObject({ id: 'health-7', sequenceNumber: 7, status: 'recorded' });
});

test('createHierarchy blocks an overlapping second parent for a child meter', async () => {
  const childId = '32345678-1234-4234-8234-123456789abc';
  const evidenceId = '42345678-1234-4234-8234-123456789abc';
  const database = { query: jest.fn(async (sql) => {
    if (sql.includes('SELECT parent.id AS parent_id')) return { rows: [{ parent_id: 'parent', facility_revision_id: companyId,
      parent_unit: 'kWh', child_id: childId, child_facility: companyId, child_unit: 'kWh', evidence_id: evidenceId,
      document_name: 'wiring diagram', status: 'locked', checksum_sha256: 'a'.repeat(64), file_size_bytes: 10 }] };
    if (sql.includes('child_measurement_point_revision_id=$2')) return { rows: [{ exists: 1 }] };
    return { rows: [] };
  }) };
  const result = await new WeavenodeService(database).createHierarchy(companyId, userId, {
    hierarchyReference: 'line-b', facilityRevisionId: companyId, parentMeasurementPointRevisionId: deviceId,
    childMeasurementPointRevisionId: childId, relationKind: 'sub_meter', tolerancePercent: 2,
    effectiveFrom: '2026-01-01T00:00:00Z', evidenceDocumentId: evidenceId
  });
  expect(result.code).toBe('WEAVENODE_HIERARCHY_CHILD_CONFLICT');
});
