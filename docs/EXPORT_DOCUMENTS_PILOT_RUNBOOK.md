# Commercial Invoice and Packing List staging pilot

This guarded pilot writes synthetic shipment, document and issuance records. Run it only against an isolated
non-production database. It never makes a legal-readiness claim and does not replace export-operator or warehouse review.

## Safety gate

Confirm the database name and deployment isolation first. Never reuse production credentials. Then set:

```bash
export NODE_ENV=staging
export ALLOW_EXPORT_DOCUMENT_PILOT=1
export EXPORT_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA
export EXPORT_PILOT_DATABASE=weavecarbon_staging
npm run test:export-documents-pilot
```

The command refuses production mode, requires an explicit write acknowledgement and requires the configured database
name to exactly match PostgreSQL `current_database()`.

## What it verifies

- 25 textile/footwear goods lines are validated and exported without truncation.
- Two containers with separate seals and pallet parents are represented explicitly.
- Every line is split between a full carton and a partial carton; all quantities and net/gross weights reconcile.
- Commercial Invoice and Packing List files are generated, reviewed, promoted byte-for-byte, and reopened in both XLSX and PDF formats.
- Database MIME, size and SHA-256 values match the stored issued files.
- The XLSX files contain the final line/package and controlled-copy notice; the PDFs have valid page objects and PDF signatures.
- Issue is blocked before the required synthetic role review, and the issued SHA-256/size exactly match the reviewed file.
- CN 61/62/64 remains outside the baseline CBAM gate.
- Cross-tenant access, issued-content mutation and stale-snapshot issuance are blocked.

The pilot requires migration 022 and writes controlled copies plus `result.json` to `artifacts/export-pilot/`. Record all four checksums and obtain a human
decision on layout and business meaning before changing either report from `READY_TO_PILOT` to `READY_TO_ISSUE`.

The fixture proves the technical container-pallet-carton hierarchy and file integrity on an isolated database. It does not
prove that a real warehouse packing ledger, buyer instruction, letter of credit or customs valuation requirement was met.
