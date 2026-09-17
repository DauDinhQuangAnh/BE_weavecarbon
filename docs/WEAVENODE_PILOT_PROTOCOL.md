# G2-06/G2-10 WeaveNode signed-ingestion and operations pilot

Status: implemented software baseline, not a device certification or automated emissions calculation. A real gateway, intermittent-network soak test, mTLS/key custody review, on-device update/rollback test and site calibration approval remain open.

## Enrollment and access

Create an industrial measurement point with `sourceType: "weavenode"` and its canonical unit. A B2B company admin provisions `POST /api/weavenode/devices` with `measurementPointRevisionId`, a stable `deviceReference`, an Ed25519 SPKI PEM **public** key and optional `protocolVersion`. New devices default to `weavenode-ed25519-v2`; v1 remains supported for already-provisioned devices. Never submit a private key. The API stores the public-key fingerprint and binds the device to the company and point. Admins can append calibration revisions from locked/checksummed evidence, revoke a device, inspect its packet ledger, and replay buffered packets. Packet and health ingest are public routes authenticated by their device signatures.

## Packet signature v1

POST `/api/weavenode/ingest` JSON with `deviceId`, numeric `sequenceNumber` (starting at 1), ISO date-time `recordedAt`, `periodStart`, `periodEnd`, numeric nonnegative `quantity`, `unit` (exactly the bound point's canonical unit), and `signatureBase64`.

The signed UTF-8 bytes are the literal prefix `weavenode-ed25519-v1`, one LF (`\n`), then compact JSON with properties in exactly this order:

```json
{"protocol":"weavenode-ed25519-v1","deviceId":"...","sequenceNumber":1,"recordedAt":"2026-09-16T10:00:00.000Z","periodStart":"2026-09-16T09:00:00.000Z","periodEnd":"2026-09-16T11:00:00.000Z","quantity":42.5,"unit":"kWh"}
```

Normalize all timestamps to UTC with three millisecond digits before signing. Use the same JavaScript JSON number representation as `JSON.stringify` for quantity; cross-language gateway implementations must match these bytes exactly. Sign using Ed25519 and standard padded Base64. The server verifies the signature before writing a packet. The 90-day buffer window and five-minute future tolerance bound accepted timestamps. Identical retransmission of a sequence returns `duplicate`; different content for an existing sequence returns conflict. An accepted packet is initially `buffered`, not an activity or emissions result.

## Packet signature v2 and dual time

Protocol v2 adds required `gatewayReceivedAt`. The signed payload order is `protocol`, `deviceId`, `sequenceNumber`, `recordedAt`, `gatewayReceivedAt`, `periodStart`, `periodEnd`, `quantity`, `unit`, prefixed by `weavenode-ed25519-v2` and LF. The gateway timestamp must be at or after the source timestamp. The immutable packet record stores source, gateway and server timestamps plus source-to-gateway drift. Legacy v1 packets expose a zero-drift fallback.

## Signed device health

`POST /api/weavenode/health` accepts a signed `weavenode-health-ed25519-v1` envelope containing `deviceId`, `sequenceNumber`, source/gateway timestamps, firmware/config versions, buffer depth, free storage, sensor status and fault codes. Health reports are immutable and sequence-deduplicated. Company users inspect them at `GET /api/weavenode/devices/{deviceId}/health`; the latest report is included in the device list.

## Replay and calibration

An admin records `POST /api/weavenode/devices/{deviceId}/calibrations` with `validFrom`, `validTo`, `evidenceDocumentId`, and `notes`. Evidence must belong to the same company, be locked or third-party-verified, have a SHA-256 checksum, and have nonzero file size. The server snapshots the evidence identity and checksum.

`POST /api/weavenode/devices/{deviceId}/replay` processes at most 100 consecutive packets starting at sequence 1 or the next accepted sequence. A sequence gap or missing/currently invalid calibration stops replay and leaves the rest buffered. Accepted packets create one immutable industrial activity (`sourceKind: sensor`, conservative `dataQualityLevel: L3`) and a calibration-evidence link in the same transaction. Replay is serialized per device. A revoked device cannot ingest or replay. The application does not compute GHG from these readings, assert DQL certification, or approve a regulatory submission automatically.

## Meter hierarchy and reconciliation

Company admins append evidence-bound parent/child meter hierarchy revisions at `/api/weavenode/meter-hierarchies`. Parent and child points must belong to the same company and facility, use the same canonical unit, and cannot create a cycle. Supporting evidence must be locked or third-party verified and checksum controlled.

`POST /api/weavenode/meter-reconciliations` builds an immutable period snapshot from the effective hierarchy and canonical activities. It records parent/child quantities, variance, tolerance, missing-data state, hierarchy hashes and contributing activity hashes. A reconciliation is an integrity control, not an emissions calculation.

## Signed staged updates and configuration audit

Admins register Ed25519 release public keys at `/api/weavenode/release-keys`; revocation is append-only. Firmware and configuration update manifests are verified with the active release key and recorded at `/api/weavenode/devices/{deviceId}/updates`. A release reference must progress `staged` → `canary` → `production`; `rollback` must point to a prior non-rollback revision for the same device and release reference. The ledger records artifact and signed-manifest SHA-256 values, stage, target version and reason. The API records authorization and history; actual artifact distribution and device execution stay outside this software baseline.

## Site acceptance still required

Test on a real device/gateway with power loss, delayed and reordered delivery, key compromise/revocation, clock drift, unit mapping, high packet rate, certificate changes, health faults, hierarchy variance, signed update failure and rollback, and independent calibration evidence. Verify mTLS identity and key rotation at the transport layer. G2-06/G2-10 remains a software baseline until those results are recorded.
