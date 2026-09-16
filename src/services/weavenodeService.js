const pool = require('../config/database');
const controls = require('./weavenodeControls');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = (code, message, status = 422) => ({ blocked: true, code, message, status });

class WeavenodeService {
  constructor(database = pool) { this.database = database; }

  async list(companyId) {
    const result = await this.database.query(
      `SELECT d.id, d.device_reference, d.measurement_point_revision_id, d.public_key_sha256, d.protocol_version,
              d.created_at, p.measurement_point_reference, p.canonical_unit,
              EXISTS (SELECT 1 FROM weavenode_device_events e WHERE e.company_id=d.company_id AND e.device_id=d.id AND e.event_type='revoked') AS revoked,
              (SELECT MAX(a.sequence_number) FROM weavenode_packet_acceptances a WHERE a.company_id=d.company_id AND a.device_id=d.id) AS last_accepted_sequence,
              (SELECT COUNT(*) FROM weavenode_packets q LEFT JOIN weavenode_packet_acceptances a ON a.packet_id=q.id
                WHERE q.company_id=d.company_id AND q.device_id=d.id AND a.id IS NULL) AS buffered_count
       FROM weavenode_devices d JOIN industrial_measurement_point_revisions p ON p.id=d.measurement_point_revision_id AND p.company_id=d.company_id
       WHERE d.company_id=$1 ORDER BY d.created_at DESC LIMIT 200`, [companyId]);
    return result.rows.map((row) => ({ id: row.id, deviceReference: row.device_reference,
      measurementPointRevisionId: row.measurement_point_revision_id, measurementPointReference: row.measurement_point_reference,
      canonicalUnit: row.canonical_unit, publicKeySha256: row.public_key_sha256, protocolVersion: row.protocol_version,
      revoked: row.revoked, lastAcceptedSequence: Number(row.last_accepted_sequence || 0), bufferedCount: Number(row.buffered_count), createdAt: row.created_at }));
  }

  async provision(companyId, userId, input) {
    const parsed = controls.provision(input);
    if (parsed.errors.length) return blocked('WEAVENODE_PROVISION_INVALID', parsed.errors.join(' '));
    const point = await this.database.query(
      `SELECT id FROM industrial_measurement_point_revisions WHERE id=$1 AND company_id=$2 AND source_type='weavenode'`,
      [parsed.value.measurementPointRevisionId, companyId]);
    if (!point.rows[0]) return blocked('WEAVENODE_POINT_INVALID', 'A WeaveNode measurement point in the active company is required.');
    try {
      const result = await this.database.query(
        `INSERT INTO weavenode_devices(company_id,measurement_point_revision_id,device_reference,public_key_pem,public_key_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,device_reference,public_key_sha256,created_at`,
        [companyId, parsed.value.measurementPointRevisionId, parsed.value.deviceReference, parsed.value.publicKeyPem, parsed.value.publicKeySha256, userId]);
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') return blocked('WEAVENODE_DEVICE_DUPLICATE', 'Device reference or public key is already provisioned.', 409);
      throw error;
    }
  }

  async revoke(companyId, userId, deviceId, reason) {
    if (!UUID.test(deviceId) || !String(reason || '').trim() || String(reason).length > 2000) return blocked('WEAVENODE_REVOKE_INVALID', 'A device UUID and reason are required.');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const device = await client.query('SELECT id FROM weavenode_devices WHERE id=$1 AND company_id=$2 FOR UPDATE', [deviceId, companyId]);
      if (!device.rows[0]) { await client.query('ROLLBACK'); return blocked('WEAVENODE_DEVICE_NOT_FOUND', 'Device not found.', 404); }
      const result = await client.query(
        `INSERT INTO weavenode_device_events(company_id,device_id,event_type,reason,recorded_by)
         VALUES($1,$2,'revoked',$3,$4) ON CONFLICT (company_id,device_id,event_type) DO NOTHING RETURNING id,created_at`,
        [companyId, deviceId, String(reason).trim(), userId]);
      await client.query('COMMIT');
      return result.rows[0] || blocked('WEAVENODE_ALREADY_REVOKED', 'Device already revoked.', 409);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async calibrate(companyId, userId, deviceId, input) {
    const parsed = controls.calibration(input);
    if (!UUID.test(deviceId) || parsed.errors.length) return blocked('WEAVENODE_CALIBRATION_INVALID', parsed.errors.join(' ') || 'Invalid device UUID.');
    const result = await this.database.query(
      `INSERT INTO weavenode_calibration_revisions(company_id,device_id,valid_from,valid_to,evidence_document_id,evidence_snapshot,notes,recorded_by)
       SELECT $1,d.id,$3,$4,e.id,jsonb_build_object('id',e.id,'name',e.document_name,'status',e.status,
         'checksumSha256',e.checksum_sha256,'fileSizeBytes',e.file_size_bytes),$6,$7
       FROM weavenode_devices d JOIN evidence_documents e ON e.id=$5 AND e.company_id=d.company_id
       WHERE d.id=$2 AND d.company_id=$1 AND e.status IN ('locked','third_party_verified')
         AND e.checksum_sha256 ~* '^[a-f0-9]{64}$' AND e.file_size_bytes > 0
         AND NOT EXISTS (SELECT 1 FROM weavenode_device_events x WHERE x.device_id=d.id AND x.company_id=$1 AND x.event_type='revoked')
       RETURNING id,valid_from,valid_to,evidence_snapshot,created_at`,
      [companyId, deviceId, parsed.value.validFrom, parsed.value.validTo, parsed.value.evidenceDocumentId, parsed.value.notes, userId]);
    return result.rows[0] || blocked('WEAVENODE_CALIBRATION_EVIDENCE_INVALID', 'Active device and locked, checksummed calibration evidence are required.');
  }

  async ingest(input, now = new Date()) {
    const candidate = controls.packet(input, now);
    if (candidate.errors.length) return blocked('WEAVENODE_PACKET_INVALID', candidate.errors.join(' '));
    const result = await this.database.query(
      `SELECT d.id,d.company_id,d.public_key_pem,p.canonical_unit,
              EXISTS (SELECT 1 FROM weavenode_device_events e WHERE e.company_id=d.company_id AND e.device_id=d.id AND e.event_type='revoked') AS revoked
       FROM weavenode_devices d JOIN industrial_measurement_point_revisions p ON p.id=d.measurement_point_revision_id AND p.company_id=d.company_id
       WHERE d.id=$1`, [candidate.value.deviceId]);
    const device = result.rows[0];
    if (!device || device.revoked) return blocked('WEAVENODE_DEVICE_UNAVAILABLE', 'Device is unknown or revoked.', 403);
    const verified = controls.verifyPacket(device.public_key_pem, input, now);
    if (!verified.validSignature) return blocked('WEAVENODE_SIGNATURE_INVALID', 'Device signature is invalid.', 403);
    if (verified.value.unit !== device.canonical_unit) return blocked('WEAVENODE_UNIT_MISMATCH', 'Packet unit differs from the bound measurement point.');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM weavenode_devices WHERE id=$1 AND company_id=$2 FOR UPDATE', [device.id, device.company_id]);
      const revoked = await client.query(`SELECT id FROM weavenode_device_events WHERE device_id=$1 AND company_id=$2 AND event_type='revoked'`, [device.id, device.company_id]);
      if (revoked.rows[0]) { await client.query('ROLLBACK'); return blocked('WEAVENODE_DEVICE_UNAVAILABLE', 'Device is revoked.', 403); }
      const inserted = await client.query(
        `INSERT INTO weavenode_packets(company_id,device_id,sequence_number,payload,payload_sha256,signature_base64)
         VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (device_id,sequence_number) DO NOTHING RETURNING id`,
        [device.company_id, device.id, verified.value.sequenceNumber, JSON.stringify(verified.payload), verified.payloadSha256, verified.value.signatureBase64]);
      let response;
      if (inserted.rows[0]) response = { packetId: inserted.rows[0].id, sequenceNumber: verified.value.sequenceNumber, status: 'buffered' };
      else {
        const previous = await client.query('SELECT id,payload_sha256 FROM weavenode_packets WHERE device_id=$1 AND sequence_number=$2', [device.id, verified.value.sequenceNumber]);
        response = previous.rows[0]?.payload_sha256 === verified.payloadSha256
          ? { packetId: previous.rows[0].id, sequenceNumber: verified.value.sequenceNumber, status: 'duplicate' }
          : blocked('WEAVENODE_SEQUENCE_CONFLICT', 'Sequence number was already used for a different payload.', 409);
      }
      await client.query('COMMIT'); return response;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async packets(companyId, deviceId) {
    if (!UUID.test(deviceId)) return null;
    const device = await this.database.query('SELECT id FROM weavenode_devices WHERE id=$1 AND company_id=$2', [deviceId, companyId]);
    if (!device.rows[0]) return null;
    const result = await this.database.query(
      `SELECT q.id,q.sequence_number,q.payload_sha256,q.received_at,q.payload->>'recordedAt' AS recorded_at,
              a.activity_id,a.calibration_revision_id,a.created_at AS accepted_at
       FROM weavenode_packets q LEFT JOIN weavenode_packet_acceptances a ON a.packet_id=q.id AND a.company_id=q.company_id
       WHERE q.company_id=$1 AND q.device_id=$2 ORDER BY q.sequence_number DESC LIMIT 200`, [companyId, deviceId]);
    return result.rows.map((row) => ({ packetId: row.id, sequenceNumber: Number(row.sequence_number), payloadSha256: row.payload_sha256,
      recordedAt: row.recorded_at, receivedAt: row.received_at, status: row.activity_id ? 'accepted' : 'buffered',
      activityId: row.activity_id, calibrationRevisionId: row.calibration_revision_id, acceptedAt: row.accepted_at }));
  }

  async replay(companyId, userId, deviceId) {
    if (!UUID.test(deviceId)) return blocked('WEAVENODE_DEVICE_INVALID', 'Invalid device UUID.');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const deviceResult = await client.query(
        `SELECT d.id,d.company_id,d.measurement_point_revision_id,p.facility_revision_id,p.process_revision_id,p.measurement_type,p.canonical_unit
         FROM weavenode_devices d JOIN industrial_measurement_point_revisions p ON p.id=d.measurement_point_revision_id AND p.company_id=d.company_id
         WHERE d.id=$1 AND d.company_id=$2 FOR UPDATE OF d`, [deviceId, companyId]);
      const device = deviceResult.rows[0];
      if (!device) { await client.query('ROLLBACK'); return blocked('WEAVENODE_DEVICE_NOT_FOUND', 'Device not found.', 404); }
      const revocation = await client.query(`SELECT id FROM weavenode_device_events WHERE company_id=$1 AND device_id=$2 AND event_type='revoked'`, [companyId, deviceId]);
      if (revocation.rows[0]) { await client.query('ROLLBACK'); return blocked('WEAVENODE_DEVICE_REVOKED', 'Revoked device cannot be replayed.', 403); }
      const last = await client.query('SELECT COALESCE(MAX(sequence_number),0) AS value FROM weavenode_packet_acceptances WHERE company_id=$1 AND device_id=$2', [companyId, deviceId]);
      let expected = Number(last.rows[0].value) + 1;
      const queued = await client.query('SELECT * FROM weavenode_packets WHERE company_id=$1 AND device_id=$2 AND sequence_number >= $3 ORDER BY sequence_number LIMIT 100', [companyId, deviceId, expected]);
      const accepted = [];
      let blocker = null;
      for (const packet of queued.rows) {
        const sequence = Number(packet.sequence_number);
        if (sequence !== expected) { blocker = { code: 'WEAVENODE_SEQUENCE_GAP', expectedSequence: expected }; break; }
        const calibration = await client.query(
          `SELECT c.id,c.evidence_document_id FROM weavenode_calibration_revisions c
           JOIN evidence_documents e ON e.id=c.evidence_document_id AND e.company_id=c.company_id
           WHERE c.company_id=$1 AND c.device_id=$2 AND c.valid_from <= $3 AND c.valid_to >= $3
             AND e.status IN ('locked','third_party_verified')
             AND e.checksum_sha256=c.evidence_snapshot->>'checksumSha256' AND e.file_size_bytes > 0
           ORDER BY c.created_at DESC,c.id DESC LIMIT 1`, [companyId, deviceId, packet.payload.recordedAt]);
        if (!calibration.rows[0]) { blocker = { code: 'WEAVENODE_CALIBRATION_MISSING', expectedSequence: expected }; break; }
        const activity = await client.query(
          `INSERT INTO industrial_activity_records(company_id,facility_revision_id,process_revision_id,measurement_point_revision_id,
             activity_reference,activity_type,period_start,period_end,quantity,canonical_unit,source_kind,data_quality_level,raw_payload,source_sha256,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sensor','L3',$11::jsonb,$12,$13) RETURNING id`,
          [companyId, device.facility_revision_id, device.process_revision_id, device.measurement_point_revision_id,
            `WN:${deviceId}:${sequence}`, device.measurement_type, packet.payload.periodStart, packet.payload.periodEnd,
            packet.payload.quantity, device.canonical_unit,
            JSON.stringify({ protocol: controls.PROTOCOL, deviceId, sequenceNumber: sequence, packetId: packet.id, calibrationRevisionId: calibration.rows[0].id }),
            packet.payload_sha256, userId]);
        await client.query(
          `INSERT INTO industrial_activity_evidence(company_id,activity_id,evidence_document_id,relationship,linked_by)
           VALUES($1,$2,$3,'calibration_record',$4)`, [companyId, activity.rows[0].id, calibration.rows[0].evidence_document_id, userId]);
        await client.query(
          `INSERT INTO weavenode_packet_acceptances(company_id,device_id,packet_id,sequence_number,calibration_revision_id,activity_id,processed_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`, [companyId, deviceId, packet.id, sequence, calibration.rows[0].id, activity.rows[0].id, userId]);
        accepted.push({ sequenceNumber: sequence, activityId: activity.rows[0].id });
        expected += 1;
      }
      await client.query('COMMIT');
      return { accepted, nextSequence: expected, blocker, remainingBatchPossible: queued.rows.length === 100 };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }
}

module.exports = { WeavenodeService, weavenodeService: new WeavenodeService() };
