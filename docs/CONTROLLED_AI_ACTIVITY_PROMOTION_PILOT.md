# G2-14 Controlled AI/OCR Activity Promotion

Status: implemented software baseline on `feat/g2-industrial-core-baseline`.

This phase implements the 12 September requirement that AI may extract, suggest semantic mappings, flag anomalies and suggest evidence matches, but may not create authoritative activity data without human review. It does not authorize AI to select an emission factor, change a calculation result or claim independent verification.

## Controlled workflow

1. OCR output remains a suggestion in `evidence_documents.extracted_json`.
2. A named `evidence_ai_reviewer` accepts or corrects every reviewable field against the exact evidence checksum and extraction snapshot.
3. The governed mapper publishes deterministic, versioned raw-label-to-canonical-field suggestions. Factor and calculation-output labels are forced to `unmapped`.
4. The service proposes up to ten controlled same-tenant evidence matches using explicit product, shipment, reporting-period, vendor and document-type signals. Factor, methodology, PCF-source and calculation documents are excluded from this activity-evidence suggestion set.
5. A company administrator records one semantic decision for every reviewed field, resolves every warning, explicitly accepts or rejects every evidence-match suggestion and supplies the canonical activity context.
6. The server saves an immutable candidate. Invalid candidates are retained as `blocked`; they do not create activity data.
7. A separate action with the named role `industrial_activity_promoter` and an explicit attestation rechecks source checksums, extraction snapshot, evidence matches, facility/process/measurement references and payload validity.
8. Only a blocker-free candidate creates one `industrial_activity_records` row, tenant-bound evidence links and an immutable promotion record in the same transaction.

OCR promotion is capped at DQL `L1`–`L3`. `L4` and `L5` require reconciliation or independent-verification evidence outside this workflow.

## API surface

- `GET /api/evidence/{id}/extraction-reviews/{reviewId}/activity-promotion-suggestions`
- `POST /api/evidence/{id}/extraction-reviews/{reviewId}/activity-candidates`
- `GET /api/evidence/{id}/activity-candidates`
- `POST /api/evidence/{id}/activity-candidates/{candidateId}/promote`

The legacy `POST /api/evidence/{id}/verify` and lock alias now fail closed when reviewable AI/OCR fields exist. Platform-owned `auditClaims` metadata is not misrepresented as an OCR field.

## Isolated PostgreSQL pilot

Run only on a disposable or explicitly approved isolated database:

```powershell
$env:ALLOW_AI_ACTIVITY_PROMOTION_PILOT='1'
$env:AI_ACTIVITY_PROMOTION_PILOT_CONFIRM='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:AI_ACTIVITY_PROMOTION_PILOT_DATABASE='weavecarbon'
npm run test:ai-activity-promotion-pilot
```

The pilot refuses a database-name mismatch and rolls back all synthetic rows. It proves:

- migration 052 is current;
- deterministic suggestions exclude factor fields;
- an OCR candidate claiming L5 is persisted as blocked and cannot be promoted;
- a valid candidate requires a separate named promotion action;
- exactly one authoritative activity and evidence link are created;
- repeated promotion is idempotent;
- cross-tenant references fail; and
- candidate and promotion ledgers reject update/delete mutation.

The machine-readable result is written to `artifacts/ai-activity-promotion-pilot/result.json` and retained by CI for 14 days.

## Remaining acceptance boundary

The software pilot uses synthetic records and deterministic label rules. Before production readiness is claimed, evaluate extraction and mapping accuracy on representative invoice, BOM, logistics, meter and calibration documents; record model/version provenance for the external extraction service; complete a real-facility human workflow pilot; and obtain the required domain, security and privacy acceptance. This phase does not provide an official factor, carbon result, certificate or assurance conclusion.
