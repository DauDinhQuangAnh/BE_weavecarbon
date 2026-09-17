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
                WHERE q.company_id=d.company_id AND q.device_id=d.id AND a.id IS NULL) AS buffered_count,
              (SELECT to_jsonb(h) FROM weavenode_health_reports h WHERE h.company_id=d.company_id AND h.device_id=d.id ORDER BY h.sequence_number DESC LIMIT 1) AS latest_health,
              (SELECT to_jsonb(u) FROM weavenode_update_revisions u WHERE u.company_id=d.company_id AND u.device_id=d.id ORDER BY u.created_at DESC,u.id DESC LIMIT 1) AS latest_update
       FROM weavenode_devices d JOIN industrial_measurement_point_revisions p ON p.id=d.measurement_point_revision_id AND p.company_id=d.company_id
       WHERE d.company_id=$1 ORDER BY d.created_at DESC LIMIT 200`, [companyId]);
    return result.rows.map((row) => ({ id: row.id, deviceReference: row.device_reference,
      measurementPointRevisionId: row.measurement_point_revision_id, measurementPointReference: row.measurement_point_reference,
      canonicalUnit: row.canonical_unit, publicKeySha256: row.public_key_sha256, protocolVersion: row.protocol_version,
      revoked: row.revoked, lastAcceptedSequence: Number(row.last_accepted_sequence || 0), bufferedCount: Number(row.buffered_count),
      latestHealth: row.latest_health, latestUpdate: row.latest_update, createdAt: row.created_at }));
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
        `INSERT INTO weavenode_devices(company_id,measurement_point_revision_id,device_reference,public_key_pem,public_key_sha256,protocol_version,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,device_reference,public_key_sha256,protocol_version,created_at`,
        [companyId, parsed.value.measurementPointRevisionId, parsed.value.deviceReference, parsed.value.publicKeyPem,
          parsed.value.publicKeySha256, parsed.value.protocolVersion, userId]);
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
      `SELECT d.id,d.company_id,d.public_key_pem,d.protocol_version,p.canonical_unit,
              EXISTS (SELECT 1 FROM weavenode_device_events e WHERE e.company_id=d.company_id AND e.device_id=d.id AND e.event_type='revoked') AS revoked
       FROM weavenode_devices d JOIN industrial_measurement_point_revisions p ON p.id=d.measurement_point_revision_id AND p.company_id=d.company_id
       WHERE d.id=$1`, [candidate.value.deviceId]);
    const device = result.rows[0];
    if (!device || device.revoked) return blocked('WEAVENODE_DEVICE_UNAVAILABLE', 'Device is unknown or revoked.', 403);
    if (candidate.value.protocol !== device.protocol_version) return blocked('WEAVENODE_PROTOCOL_MISMATCH', 'Packet protocol differs from the provisioned device protocol.');
    const verified = controls.verifyPacket(device.public_key_pem, input, now);
    if (!verified.validSignature) return blocked('WEAVENODE_SIGNATURE_INVALID', 'Device signature is invalid.', 403);
    if (verified.value.unit !== device.canonical_unit) return blocked('WEAVENODE_UNIT_MISMATCH', 'Packet unit differs from the bound measurement point.');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM weavenode_devices WHERE id=$1 AND company_id=$2 FOR UPDATE', [device.id, device.company_id]);
      const revoked = await client.query(`SELECT id FROM weavenode_device_events WHERE device_id=$1 AND company_id=$2 AND event_type='revoked'`, [device.id, device.company_id]);
      if (revoked.rows[0]) { await client.query('ROLLBACK'); return blocked('WEAVENODE_DEVICE_UNAVAILABLE', 'Device is revoked.', 403); }
      const sourceRecordedAt = verified.payload.recordedAt;
      const gatewayReceivedAt = verified.payload.gatewayReceivedAt || sourceRecordedAt;
      const driftSeconds = (new Date(gatewayReceivedAt) - new Date(sourceRecordedAt)) / 1000;
      const inserted = await client.query(
        `INSERT INTO weavenode_packets(company_id,device_id,sequence_number,payload,payload_sha256,signature_base64,
           source_recorded_at,gateway_received_at,source_gateway_drift_seconds)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) ON CONFLICT (device_id,sequence_number) DO NOTHING RETURNING id`,
        [device.company_id, device.id, verified.value.sequenceNumber, JSON.stringify(verified.payload), verified.payloadSha256,
          verified.value.signatureBase64, sourceRecordedAt, gatewayReceivedAt, driftSeconds]);
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
      `SELECT q.id,q.sequence_number,q.payload_sha256,q.received_at,
              COALESCE(q.source_recorded_at,(q.payload->>'recordedAt')::timestamptz) AS source_recorded_at,
              COALESCE(q.gateway_received_at,(COALESCE(q.payload->>'gatewayReceivedAt',q.payload->>'recordedAt'))::timestamptz) AS gateway_received_at,
              COALESCE(q.source_gateway_drift_seconds,EXTRACT(EPOCH FROM ((COALESCE(q.payload->>'gatewayReceivedAt',q.payload->>'recordedAt'))::timestamptz-(q.payload->>'recordedAt')::timestamptz))) AS source_gateway_drift_seconds,
              a.activity_id,a.calibration_revision_id,a.created_at AS accepted_at
       FROM weavenode_packets q LEFT JOIN weavenode_packet_acceptances a ON a.packet_id=q.id AND a.company_id=q.company_id
       WHERE q.company_id=$1 AND q.device_id=$2 ORDER BY q.sequence_number DESC LIMIT 200`, [companyId, deviceId]);
    return result.rows.map((row) => ({ packetId: row.id, sequenceNumber: Number(row.sequence_number), payloadSha256: row.payload_sha256,
      recordedAt: row.source_recorded_at, gatewayReceivedAt: row.gateway_received_at,
      serverReceivedAt: row.received_at, clockDriftSeconds: Number(row.source_gateway_drift_seconds || 0), status: row.activity_id ? 'accepted' : 'buffered',
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
            JSON.stringify({ protocol: packet.payload.protocol, deviceId, sequenceNumber: sequence, packetId: packet.id,
              sourceRecordedAt: packet.payload.recordedAt, gatewayReceivedAt: packet.payload.gatewayReceivedAt || packet.payload.recordedAt,
              serverReceivedAt: packet.received_at, calibrationRevisionId: calibration.rows[0].id }),
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

  async ingestHealth(input, now = new Date()) {
    const parsed = controls.health(input, now);
    if (parsed.errors.length) return blocked('WEAVENODE_HEALTH_INVALID', parsed.errors.join(' '));
    const result = await this.database.query(
      `SELECT d.id,d.company_id,d.public_key_pem,
              EXISTS (SELECT 1 FROM weavenode_device_events e WHERE e.company_id=d.company_id AND e.device_id=d.id AND e.event_type='revoked') AS revoked
       FROM weavenode_devices d WHERE d.id=$1`, [parsed.value.deviceId]);
    const device = result.rows[0];
    if (!device || device.revoked) return blocked('WEAVENODE_DEVICE_UNAVAILABLE', 'Device is unknown or revoked.', 403);
    const verified = controls.verifyHealth(device.public_key_pem, input, now);
    if (!verified.validSignature) return blocked('WEAVENODE_HEALTH_SIGNATURE_INVALID', 'Health signature is invalid.', 403);
    try {
      const saved = await this.database.query(
        `INSERT INTO weavenode_health_reports
          (company_id,device_id,sequence_number,source_recorded_at,gateway_received_at,clock_drift_seconds,
           firmware_version,config_version,buffer_depth,storage_free_bytes,sensor_status,fault_codes,payload,payload_sha256,signature_base64)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)
         RETURNING id,sequence_number,server_received_at`,
        [device.company_id, device.id, verified.value.sequenceNumber, verified.payload.recordedAt,
          verified.payload.gatewayReceivedAt, (new Date(verified.payload.gatewayReceivedAt) - new Date(verified.payload.recordedAt)) / 1000,
          verified.payload.firmwareVersion, verified.payload.configVersion, verified.payload.bufferDepth,
          verified.payload.storageFreeBytes, verified.payload.sensorStatus, JSON.stringify(verified.payload.faultCodes),
          JSON.stringify(verified.payload), verified.payloadSha256, verified.value.signatureBase64]);
      return { id: saved.rows[0].id, sequenceNumber: Number(saved.rows[0].sequence_number), status: 'recorded', serverReceivedAt: saved.rows[0].server_received_at };
    } catch (error) {
      if (error.code !== '23505') throw error;
      const previous = await this.database.query('SELECT id,payload_sha256 FROM weavenode_health_reports WHERE device_id=$1 AND sequence_number=$2', [device.id, verified.value.sequenceNumber]);
      return previous.rows[0]?.payload_sha256 === verified.payloadSha256
        ? { id: previous.rows[0].id, sequenceNumber: verified.value.sequenceNumber, status: 'duplicate' }
        : blocked('WEAVENODE_HEALTH_SEQUENCE_CONFLICT', 'Health sequence was already used for different content.', 409);
    }
  }

  async health(companyId, deviceId) {
    if (!UUID.test(deviceId)) return null;
    const result = await this.database.query(
      `SELECT d.id AS device_exists,h.* FROM weavenode_devices d LEFT JOIN weavenode_health_reports h
         ON h.device_id=d.id AND h.company_id=d.company_id
       WHERE d.company_id=$1 AND d.id=$2 ORDER BY h.sequence_number DESC NULLS LAST LIMIT 200`, [companyId, deviceId]);
    if (!result.rows[0]) return null;
    if (!result.rows[0].id) return [];
    return result.rows.map((row) => ({ id: row.id, sequenceNumber: Number(row.sequence_number),
      recordedAt: row.source_recorded_at, gatewayReceivedAt: row.gateway_received_at, serverReceivedAt: row.server_received_at,
      clockDriftSeconds: Number(row.clock_drift_seconds), firmwareVersion: row.firmware_version,
      configVersion: row.config_version, bufferDepth: Number(row.buffer_depth), storageFreeBytes: Number(row.storage_free_bytes),
      sensorStatus: row.sensor_status, faultCodes: row.fault_codes, payloadSha256: row.payload_sha256 }));
  }

  async createHierarchy(companyId, userId, input) {
    const parsed = controls.hierarchy(input);
    if (parsed.errors.length) return blocked('WEAVENODE_HIERARCHY_INVALID', parsed.errors.join(' '));
    const value = parsed.value;
    const result = await this.database.query(
      `SELECT parent.id AS parent_id,parent.facility_revision_id,parent.canonical_unit AS parent_unit,
              child.id AS child_id,child.facility_revision_id AS child_facility,child.canonical_unit AS child_unit,
              e.id AS evidence_id,e.document_name,e.status,e.checksum_sha256,e.file_size_bytes
       FROM industrial_measurement_point_revisions parent
       JOIN industrial_measurement_point_revisions child ON child.id=$4 AND child.company_id=parent.company_id
       JOIN evidence_documents e ON e.id=$5 AND e.company_id=parent.company_id
       WHERE parent.id=$3 AND parent.company_id=$1 AND parent.facility_revision_id=$2`,
      [companyId, value.facilityRevisionId, value.parentMeasurementPointRevisionId, value.childMeasurementPointRevisionId, value.evidenceDocumentId]);
    const refs = result.rows[0];
    if (!refs || refs.child_facility !== value.facilityRevisionId || refs.parent_unit !== refs.child_unit
      || !['locked', 'third_party_verified'].includes(refs.status) || !/^[a-f0-9]{64}$/i.test(refs.checksum_sha256 || '') || Number(refs.file_size_bytes || 0) <= 0) {
      return blocked('WEAVENODE_HIERARCHY_REFERENCE_INVALID', 'Hierarchy points must share company, facility and unit, with controlled evidence.');
    }
    const duplicateChild = await this.database.query(
      `WITH latest AS (
         SELECT DISTINCT ON (hierarchy_reference) * FROM industrial_meter_hierarchy_revisions
         WHERE company_id=$1 ORDER BY hierarchy_reference,revision DESC
       ) SELECT 1 FROM latest WHERE child_measurement_point_revision_id=$2 AND hierarchy_reference<>$3
         AND tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)')
           && tstzrange($4::timestamptz,COALESCE($5::timestamptz,'infinity'::timestamptz),'[)') LIMIT 1`,
      [companyId, value.childMeasurementPointRevisionId, value.hierarchyReference, value.effectiveFrom, value.effectiveTo]);
    if (duplicateChild.rows[0]) return blocked('WEAVENODE_HIERARCHY_CHILD_CONFLICT', 'A child meter can have only one effective parent for an overlapping period.');
    const cycle = await this.database.query(
      `WITH RECURSIVE latest AS (
         SELECT DISTINCT ON (hierarchy_reference) parent_measurement_point_revision_id AS parent_id,child_measurement_point_revision_id AS child_id
         FROM industrial_meter_hierarchy_revisions WHERE company_id=$1 AND hierarchy_reference<>$4 ORDER BY hierarchy_reference,revision DESC
       ), descendants(id) AS (
         SELECT child_id FROM latest WHERE parent_id=$2
         UNION SELECT edge.child_id FROM latest edge JOIN descendants d ON edge.parent_id=d.id
       ) SELECT 1 FROM descendants WHERE id=$3 LIMIT 1`,
      [companyId, value.childMeasurementPointRevisionId, value.parentMeasurementPointRevisionId, value.hierarchyReference]);
    if (cycle.rows[0]) return blocked('WEAVENODE_HIERARCHY_CYCLE', 'Meter hierarchy cannot contain a cycle.');
    const evidenceSnapshot = { id: refs.evidence_id, documentName: refs.document_name, status: refs.status,
      checksumSha256: refs.checksum_sha256, fileSizeBytes: Number(refs.file_size_bytes) };
    const identity = { ...value, evidenceSnapshot };
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:meter-hierarchy:${value.hierarchyReference}`]);
      const next = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM industrial_meter_hierarchy_revisions WHERE company_id=$1 AND hierarchy_reference=$2', [companyId, value.hierarchyReference]);
      const saved = await client.query(
        `INSERT INTO industrial_meter_hierarchy_revisions
          (company_id,facility_revision_id,hierarchy_reference,revision,parent_measurement_point_revision_id,
           child_measurement_point_revision_id,relation_kind,tolerance_percent,effective_from,effective_to,
           evidence_document_id,evidence_snapshot,hierarchy_sha256,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
        [companyId, value.facilityRevisionId, value.hierarchyReference, Number(next.rows[0].revision),
          value.parentMeasurementPointRevisionId, value.childMeasurementPointRevisionId, value.relationKind,
          value.tolerancePercent, value.effectiveFrom, value.effectiveTo, value.evidenceDocumentId,
          JSON.stringify(evidenceSnapshot), controls.sha(controls.stableJson(identity)), userId]);
      await client.query('COMMIT'); return this.formatHierarchy(saved.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listHierarchies(companyId) {
    const result = await this.database.query(
      `SELECT h.*,parent.measurement_point_reference AS parent_reference,child.measurement_point_reference AS child_reference
       FROM industrial_meter_hierarchy_revisions h
       JOIN industrial_measurement_point_revisions parent ON parent.id=h.parent_measurement_point_revision_id AND parent.company_id=h.company_id
       JOIN industrial_measurement_point_revisions child ON child.id=h.child_measurement_point_revision_id AND child.company_id=h.company_id
       WHERE h.company_id=$1 ORDER BY h.created_at DESC`, [companyId]);
    return result.rows.map((row) => this.formatHierarchy(row));
  }

  async reconcile(companyId, userId, input) {
    const parsed = controls.reconciliation(input);
    if (parsed.errors.length) return blocked('WEAVENODE_RECONCILIATION_INVALID', parsed.errors.join(' '));
    const value = parsed.value;
    const hierarchy = await this.database.query(
      `WITH latest AS (
         SELECT DISTINCT ON (hierarchy_reference) h.* FROM industrial_meter_hierarchy_revisions h
         WHERE company_id=$1 AND parent_measurement_point_revision_id=$2
         ORDER BY hierarchy_reference,revision DESC
       ) SELECT h.*,parent.canonical_unit,parent.facility_revision_id,child.measurement_point_reference AS child_reference
         FROM latest h JOIN industrial_measurement_point_revisions parent ON parent.id=h.parent_measurement_point_revision_id AND parent.company_id=h.company_id
         JOIN industrial_measurement_point_revisions child ON child.id=h.child_measurement_point_revision_id AND child.company_id=h.company_id
         WHERE h.effective_from <= $4 AND (h.effective_to IS NULL OR h.effective_to >= $3)`,
      [companyId, value.parentMeasurementPointRevisionId, value.periodStart, value.periodEnd]);
    if (!hierarchy.rows.length) return blocked('WEAVENODE_HIERARCHY_NOT_FOUND', 'No effective child meter hierarchy was found.', 404);
    const pointIds = [value.parentMeasurementPointRevisionId, ...hierarchy.rows.map((row) => row.child_measurement_point_revision_id)];
    const activities = await this.database.query(
      `SELECT measurement_point_revision_id,COUNT(*) AS activity_count,COALESCE(SUM(quantity),0) AS quantity,
              jsonb_agg(jsonb_build_object('id',id,'sourceSha256',source_sha256,'quantity',quantity) ORDER BY id) AS activities
       FROM industrial_activity_records WHERE company_id=$1 AND measurement_point_revision_id=ANY($2::uuid[])
         AND period_start >= $3 AND period_end <= $4 GROUP BY measurement_point_revision_id`,
      [companyId, pointIds, value.periodStart, value.periodEnd]);
    const byPoint = new Map(activities.rows.map((row) => [row.measurement_point_revision_id, row]));
    const parent = byPoint.get(value.parentMeasurementPointRevisionId);
    const children = hierarchy.rows.map((row) => ({ hierarchyId: row.id, pointId: row.child_measurement_point_revision_id,
      reference: row.child_reference, quantity: Number(byPoint.get(row.child_measurement_point_revision_id)?.quantity || 0),
      activityCount: Number(byPoint.get(row.child_measurement_point_revision_id)?.activity_count || 0),
      activities: byPoint.get(row.child_measurement_point_revision_id)?.activities || [] }));
    const parentQuantity = Number(parent?.quantity || 0);
    const childQuantity = Number(children.reduce((sum, child) => sum + child.quantity, 0).toFixed(8));
    const differenceQuantity = Number((parentQuantity - childQuantity).toFixed(8));
    const differencePercent = parentQuantity === 0 ? (childQuantity === 0 ? 0 : null) : Number((Math.abs(differenceQuantity) / parentQuantity * 100).toFixed(8));
    const tolerancePercent = Math.min(...hierarchy.rows.map((row) => Number(row.tolerance_percent)));
    const missing = !parent || Number(parent.activity_count) === 0 || children.some((child) => child.activityCount === 0);
    const status = missing ? 'missing_data' : differencePercent !== null && differencePercent <= tolerancePercent ? 'reconciled' : 'outside_tolerance';
    const hierarchySnapshot = hierarchy.rows.map((row) => ({ id: row.id, reference: row.hierarchy_reference,
      revision: Number(row.revision), childPointId: row.child_measurement_point_revision_id,
      tolerancePercent: Number(row.tolerance_percent), hierarchySha256: row.hierarchy_sha256 }));
    const activitySnapshot = { parent: { pointId: value.parentMeasurementPointRevisionId, quantity: parentQuantity,
      activityCount: Number(parent?.activity_count || 0), activities: parent?.activities || [] }, children };
    const payload = { parentMeasurementPointRevisionId: value.parentMeasurementPointRevisionId,
      periodStart: new Date(value.periodStart).toISOString(), periodEnd: new Date(value.periodEnd).toISOString(),
      canonicalUnit: hierarchy.rows[0].canonical_unit, parentQuantity, childQuantity, differenceQuantity,
      differencePercent, tolerancePercent, status, hierarchySnapshot, activitySnapshot };
    const payloadSha256 = controls.sha(controls.stableJson(payload));
    const saved = await this.database.query(
      `INSERT INTO industrial_meter_reconciliation_snapshots
        (company_id,facility_revision_id,parent_measurement_point_revision_id,period_start,period_end,canonical_unit,
         parent_quantity,child_quantity,difference_quantity,difference_percent,tolerance_percent,status,
         hierarchy_snapshot,activity_snapshot,payload_sha256,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16)
       ON CONFLICT (company_id,payload_sha256) DO NOTHING RETURNING *`,
      [companyId, hierarchy.rows[0].facility_revision_id, value.parentMeasurementPointRevisionId,
        value.periodStart, value.periodEnd, hierarchy.rows[0].canonical_unit, parentQuantity, childQuantity,
        differenceQuantity, differencePercent, tolerancePercent, status, JSON.stringify(hierarchySnapshot),
        JSON.stringify(activitySnapshot), payloadSha256, userId]);
    if (saved.rows[0]) return this.formatReconciliation(saved.rows[0]);
    const existing = await this.database.query(
      'SELECT * FROM industrial_meter_reconciliation_snapshots WHERE company_id=$1 AND payload_sha256=$2',
      [companyId, payloadSha256]);
    return this.formatReconciliation(existing.rows[0]);
  }

  async listReconciliations(companyId) {
    const result = await this.database.query('SELECT * FROM industrial_meter_reconciliation_snapshots WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200', [companyId]);
    return result.rows.map((row) => this.formatReconciliation(row));
  }

  async createSigningKey(companyId, userId, input) {
    const parsed = controls.releaseKey(input); if (parsed.errors.length) return blocked('WEAVENODE_RELEASE_KEY_INVALID', parsed.errors.join(' '));
    try { const result = await this.database.query(
      `INSERT INTO weavenode_release_signing_keys(company_id,key_reference,public_key_pem,public_key_sha256,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING id,key_reference,public_key_sha256,created_at`,
      [companyId, parsed.value.keyReference, parsed.value.publicKeyPem, parsed.value.publicKeySha256, userId]); return result.rows[0];
    } catch (error) { if (error.code === '23505') return blocked('WEAVENODE_RELEASE_KEY_DUPLICATE', 'Release key already exists.', 409); throw error; }
  }

  async listSigningKeys(companyId) {
    const result = await this.database.query(
      `SELECT k.id,k.key_reference,k.public_key_sha256,k.created_at,
              EXISTS(SELECT 1 FROM weavenode_release_key_events e WHERE e.company_id=k.company_id AND e.signing_key_id=k.id AND e.event_type='revoked') AS revoked
       FROM weavenode_release_signing_keys k WHERE k.company_id=$1 ORDER BY k.created_at DESC`, [companyId]);
    return result.rows.map((row) => ({ id: row.id, keyReference: row.key_reference, publicKeySha256: row.public_key_sha256, revoked: row.revoked, createdAt: row.created_at }));
  }

  async revokeSigningKey(companyId, userId, keyId, reason) {
    if (!UUID.test(keyId) || !String(reason || '').trim() || String(reason).length > 2000) return blocked('WEAVENODE_RELEASE_KEY_REVOKE_INVALID', 'Signing key UUID and a reason of at most 2000 characters are required.');
    const result = await this.database.query(
      `INSERT INTO weavenode_release_key_events(company_id,signing_key_id,event_type,reason,recorded_by)
       SELECT $1,k.id,'revoked',$3,$4 FROM weavenode_release_signing_keys k WHERE k.id=$2 AND k.company_id=$1
       ON CONFLICT (company_id,signing_key_id,event_type) DO NOTHING RETURNING id,created_at`,
      [companyId, keyId, String(reason).trim(), userId]);
    return result.rows[0] || blocked('WEAVENODE_RELEASE_KEY_NOT_FOUND_OR_REVOKED', 'Signing key was not found or already revoked.', 404);
  }

  async createUpdate(companyId, userId, deviceId, input) {
    const parsed = controls.update({ ...input, deviceId });
    if (parsed.errors.length) return blocked('WEAVENODE_UPDATE_INVALID', parsed.errors.join(' '));
    const refs = await this.database.query(
      `SELECT d.id AS device_id,k.id AS key_id,k.public_key_pem,
              EXISTS(SELECT 1 FROM weavenode_device_events e WHERE e.company_id=d.company_id AND e.device_id=d.id AND e.event_type='revoked') AS device_revoked,
              EXISTS(SELECT 1 FROM weavenode_release_key_events e WHERE e.company_id=k.company_id AND e.signing_key_id=k.id AND e.event_type='revoked') AS key_revoked
       FROM weavenode_devices d JOIN weavenode_release_signing_keys k ON k.id=$3 AND k.company_id=d.company_id
       WHERE d.id=$2 AND d.company_id=$1`, [companyId, deviceId, parsed.value.signingKeyId]);
    const ref = refs.rows[0];
    if (!ref || ref.device_revoked || ref.key_revoked) return blocked('WEAVENODE_UPDATE_REFERENCE_INVALID', 'Active device and release signing key are required.');
    const verified = controls.verifyUpdate(ref.public_key_pem, { ...input, deviceId });
    if (!verified.validSignature) return blocked('WEAVENODE_UPDATE_SIGNATURE_INVALID', 'Update manifest signature is invalid.', 403);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${companyId}:weavenode-update:${deviceId}:${parsed.value.updateReference}`]);
      const previous = await client.query(
        `SELECT * FROM weavenode_update_revisions WHERE company_id=$1 AND device_id=$2 AND update_reference=$3
         ORDER BY revision DESC LIMIT 1`, [companyId, deviceId, parsed.value.updateReference]);
      const latest = previous.rows[0];
      const allowedPrevious = { staged: null, canary: 'staged', production: 'canary' };
      if (parsed.value.rolloutStage !== 'rollback' && (latest?.rollout_stage || null) !== allowedPrevious[parsed.value.rolloutStage]) {
        await client.query('ROLLBACK'); return blocked('WEAVENODE_UPDATE_STAGE_INVALID', 'Rollout must progress staged, canary, then production.');
      }
      if (parsed.value.rolloutStage === 'rollback') {
        const rollback = await client.query(
          `SELECT id FROM weavenode_update_revisions
           WHERE id=$1 AND company_id=$2 AND device_id=$3 AND update_reference=$4 AND rollout_stage <> 'rollback'`,
          [parsed.value.rollbackOfUpdateId, companyId, deviceId, parsed.value.updateReference]);
        if (!rollback.rows[0]) { await client.query('ROLLBACK'); return blocked('WEAVENODE_ROLLBACK_REFERENCE_INVALID', 'Rollback target must belong to the device.'); }
      }
      const revision = Number(latest?.revision || 0) + 1;
      const saved = await client.query(
        `INSERT INTO weavenode_update_revisions
          (company_id,device_id,update_reference,revision,update_kind,target_version,rollout_stage,artifact_sha256,
           signing_key_id,manifest,manifest_sha256,signature_base64,rollback_of_update_id,reason,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING *`,
        [companyId, deviceId, parsed.value.updateReference, revision, parsed.value.updateKind,
          parsed.value.targetVersion, parsed.value.rolloutStage, parsed.value.artifactSha256,
          parsed.value.signingKeyId, JSON.stringify(verified.payload), verified.manifestSha256,
          parsed.value.signatureBase64, parsed.value.rollbackOfUpdateId, parsed.value.reason, userId]);
      await client.query('COMMIT'); return this.formatUpdate(saved.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listUpdates(companyId, deviceId) {
    if (!UUID.test(deviceId)) return null;
    const result = await this.database.query(
      `SELECT d.id AS device_exists,u.* FROM weavenode_devices d LEFT JOIN weavenode_update_revisions u
         ON u.device_id=d.id AND u.company_id=d.company_id
       WHERE d.company_id=$1 AND d.id=$2 ORDER BY u.created_at DESC NULLS LAST`, [companyId, deviceId]);
    if (!result.rows[0]) return null;
    return result.rows[0].id ? result.rows.map((row) => this.formatUpdate(row)) : [];
  }

  formatHierarchy(row) { return { id: row.id, facilityRevisionId: row.facility_revision_id,
    hierarchyReference: row.hierarchy_reference, revision: Number(row.revision),
    parentMeasurementPointRevisionId: row.parent_measurement_point_revision_id, parentReference: row.parent_reference,
    childMeasurementPointRevisionId: row.child_measurement_point_revision_id, childReference: row.child_reference,
    relationKind: row.relation_kind, tolerancePercent: Number(row.tolerance_percent),
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, evidenceDocumentId: row.evidence_document_id,
    hierarchySha256: row.hierarchy_sha256, createdAt: row.created_at }; }

  formatReconciliation(row) { return { id: row.id, facilityRevisionId: row.facility_revision_id,
    parentMeasurementPointRevisionId: row.parent_measurement_point_revision_id, periodStart: row.period_start,
    periodEnd: row.period_end, canonicalUnit: row.canonical_unit, parentQuantity: Number(row.parent_quantity),
    childQuantity: Number(row.child_quantity), differenceQuantity: Number(row.difference_quantity),
    differencePercent: row.difference_percent === null ? null : Number(row.difference_percent),
    tolerancePercent: Number(row.tolerance_percent), status: row.status,
    hierarchySnapshot: row.hierarchy_snapshot, activitySnapshot: row.activity_snapshot,
    payloadSha256: row.payload_sha256, createdAt: row.created_at }; }

  formatUpdate(row) { return { id: row.id, deviceId: row.device_id, updateReference: row.update_reference,
    revision: Number(row.revision), updateKind: row.update_kind, targetVersion: row.target_version,
    rolloutStage: row.rollout_stage, artifactSha256: row.artifact_sha256, signingKeyId: row.signing_key_id,
    manifest: row.manifest, manifestSha256: row.manifest_sha256, rollbackOfUpdateId: row.rollback_of_update_id,
    reason: row.reason, createdAt: row.created_at }; }
}

module.exports = { WeavenodeService, weavenodeService: new WeavenodeService() };
