# G2-09 AI OCR Human Review Pilot

Status: software baseline. AI and OCR output is a suggestion, not primary data, an approved factor or an authoritative calculation input.

## Review boundary

The extraction worker stores suggested fields in `evidence_documents.extracted_json`. No calculation or industrial activity service consumes those suggestions automatically.

When a user selects Confirm in the Evidence workspace, the server now verifies that:

- the source document belongs to the active company;
- the source bytes have a non-empty file and SHA-256 checksum;
- every current extracted field is represented exactly once;
- the reviewer is a named authenticated user with the `evidence_ai_reviewer` role contract.

The server snapshots the exact extraction, evidence checksum and extraction hash. It writes one immutable field decision per suggestion. An unchanged value is `accepted`; an edited value is `corrected`. Only after all field decisions are stored does the same transaction lock the evidence and append the audit event.

## API surface

- `GET /api/evidence/{id}/fields` returns current AI/OCR suggestions.
- `POST /api/evidence/{id}/confirm` stores the named field-by-field review and locks the evidence.
- `GET /api/evidence/{id}/extraction-reviews` returns immutable review history and decisions.

## G2-14 continuation

The governed raw-label mapping, anomaly/evidence-match decisions and controlled promotion workflow are implemented in G2-14; see `docs/CONTROLLED_AI_ACTIVITY_PROMOTION_PILOT.md`. Model/version acceptance and evaluation on representative invoice, BOM, logistics, meter and calibration documents remain external gates. AI must never choose official emission factors or modify locked calculation results.
