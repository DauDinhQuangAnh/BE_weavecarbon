const crypto = require('crypto');
const { WeavenodeService } = require('../../src/services/weavenodeService');
const { packet } = require('../../src/services/weavenodeControls');

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
  const database = { connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [{ id: deviceId, company_id: companyId, public_key_pem: key, canonical_unit: 'kWh', revoked: false }] })) };
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
