# G2-06 WeaveNode signed-ingestion pilot

Status: software pilot, not a device certification or automated emissions calculation. A real gateway, intermittent-network soak test, key custody review and site calibration approval remain open.

## Enrollment and access

Create an industrial measurement point with `sourceType: "weavenode"` and its canonical unit. A B2B company admin provisions `POST /api/weavenode/devices` with `measurementPointRevisionId`, a stable `deviceReference`, and an Ed25519 SPKI PEM **public** key. Never submit a private key. The API stores the public-key fingerprint and binds the device to the company and point. Admins can append calibration revisions from locked/checksummed evidence, revoke a device, inspect its packet ledger, and replay buffered packets. Device ingest is the only unauthenticated route; the Ed25519 signature is its authentication mechanism.

## Packet signature v1

POST `/api/weavenode/ingest` JSON with `deviceId`, numeric `sequenceNumber` (starting at 1), ISO date-time `recordedAt`, `periodStart`, `periodEnd`, numeric nonnegative `quantity`, `unit` (exactly the bound point's canonical unit), and `signatureBase64`.

The signed UTF-8 bytes are the literal prefix `weavenode-ed25519-v1`, one LF (`\n`), then compact JSON with properties in exactly this order:

```json
{"protocol":"weavenode-ed25519-v1","deviceId":"...","sequenceNumber":1,"recordedAt":"2026-09-16T10:00:00.000Z","periodStart":"2026-09-16T09:00:00.000Z","periodEnd":"2026-09-16T11:00:00.000Z","quantity":42.5,"unit":"kWh"}
```

Normalize all timestamps to UTC with three millisecond digits before signing. Use the same JavaScript JSON number representation as `JSON.stringify` for quantity; cross-language gateway implementations must match these bytes exactly. Sign using Ed25519 and standard padded Base64. The server verifies the signature before writing a packet. The 90-day buffer window and five-minute future tolerance bound accepted timestamps. Identical retransmission of a sequence returns `duplicate`; different content for an existing sequence returns conflict. An accepted packet is initially `buffered`, not an activity or emissions result.

## Replay and calibration

An admin records `POST /api/weavenode/devices/{deviceId}/calibrations` with `validFrom`, `validTo`, `evidenceDocumentId`, and `notes`. Evidence must belong to the same company, be locked or third-party-verified, have a SHA-256 checksum, and have nonzero file size. The server snapshots the evidence identity and checksum.

`POST /api/weavenode/devices/{deviceId}/replay` processes at most 100 consecutive packets starting at sequence 1 or the next accepted sequence. A sequence gap or missing/currently invalid calibration stops replay and leaves the rest buffered. Accepted packets create one immutable industrial activity (`sourceKind: sensor`, conservative `dataQualityLevel: L3`) and a calibration-evidence link in the same transaction. Replay is serialized per device. A revoked device cannot ingest or replay. The application does not compute GHG from these readings, assert DQL certification, or approve a regulatory submission automatically.

## Site acceptance still required

Test on a real device/gateway with power loss, delayed and reordered delivery, key compromise/revocation, clock drift, unit mapping, high packet rate, certificate changes, and independent calibration evidence. Keep G2-06 partial until those results are recorded.
