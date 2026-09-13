# R13 corporate/facility GHG inventory pilot

## Purpose and claim boundary

This isolated synthetic pilot verifies the controlled R13 inventory workflow. It does not create an ISO certificate, independent assurance conclusion, regulatory filing, or public environmental claim.

The workflow is deliberately limited to an internal organizational Scope 1 and Scope 2 inventory. Scope 3 is explicitly declared, and biogenic carbon, removals and offsets remain separate from gross inventory totals.

## Controls exercised

- reporting entity, organizational boundary and facility mapping;
- explicit Scope 1 and Scope 2 source-category decisions;
- period-scoped reviewed electricity and fuel activity;
- reproducible activity data multiplied by emission factors;
- factor source, version and GWP-basis provenance;
- location-based Scope 2 and conditional dual reporting;
- seven-gas coverage decisions, base year and recalculation policy;
- completeness, data quality, improvement and uncertainty disclosures;
- authentic-assurance gating and non-netting of offsets;
- company isolation, immutable revisions, evidence snapshots and named append-only review.

## Local execution

Use a fresh non-production PostgreSQL database with every migration applied, then run:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_CARRIER_DOCUMENT_PILOT = '1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE = '<exact-isolated-database-name>'
$env:DATABASE_URL = '<isolated-postgresql-url>'
$env:UPLOADS_ROOT = '<isolated-upload-directory>'
npm run test:corporate-ghg-inventory-pilot
```

The database-name guard must exactly match `current_database()`. The script refuses production mode and writes only synthetic data and evidence.

## Expected evidence

`artifacts/corporate-ghg-inventory-pilot/result.json` must report `status: passed` and contain the three `r13_...` checks. Retain the CI artifact and SHA-256 digest with the release evidence.
