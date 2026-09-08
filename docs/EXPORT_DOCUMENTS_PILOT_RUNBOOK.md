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
- Every line is split between a full carton and a partial carton; all quantities and net/gross weights reconcile.
- Commercial Invoice and Packing List files are generated, stored, issued and reopened as real XLSX archives.
- Database MIME, size and SHA-256 values match the stored issued files.
- The issued files contain the final line/package and issued watermark.
- CN 61/62/64 remains outside the baseline CBAM gate.
- Cross-tenant access, issued-content mutation and stale-snapshot issuance are blocked.

The pilot writes review copies and `result.json` to `artifacts/export-pilot/`. Record the two checksums and obtain a human
decision on layout and business meaning before changing either report from `READY_TO_PILOT` to `READY_TO_ISSUE`.

This fixture does not prove multi-container hierarchy because that hierarchy is not yet represented in the current package
model. It deliberately keeps that limitation visible instead of encoding a container number into free text and calling the
requirement complete.
