# R20 compliance-applicability isolated pilot

This guarded pilot validates the technical R20 applicability-triage controls. It does not provide legal advice, issue a
permit/certificate, establish authority acceptance, or prove that the limited ruleset covers every obligation.

## Required isolation

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production` and apply migrations through
  `030_r20_compliance_applicability_core.sql`.
- Use only synthetic identities, shipments, product/material facts and evidence.
- Set the database-name guard to the exact value returned by `SELECT current_database()`.

PowerShell example:

```powershell
$env:DB_NAME='weavecarbon_staging'
$env:UPLOADS_DIR='D:\isolated\weavecarbon-r20-uploads'
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:compliance-applicability-pilot
```

The fixture is cumulative: it establishes the controlled R01-R07 shipment before checking R20.

## What a pass proves

- the evaluation records exact shipment HS/TARIC, lane, market, material and effective-date inputs;
- every result identifies its ruleset/source manifest and retains input/result SHA-256 identities;
- limited coverage and missing facts route to specialist review instead of a guessed non-applicability conclusion;
- a confirmed internal-planning review requires the exact `compliance_specialist` role and locked evidence;
- evaluations/reviews are tenant-isolated and append-only at database level.

The result is written to `artifacts/compliance-applicability-pilot/result.json`; CI retains it as a test artifact.

## What a pass does not prove

- that any product is legally compliant or exempt;
- that the ruleset is universally complete or that a cited source is still the latest effective consolidation;
- that a regulator, market-surveillance authority, importer or specialist accepts the result;
- that R08-R11 dossiers, labels, warnings, testing or declarations have been completed.
