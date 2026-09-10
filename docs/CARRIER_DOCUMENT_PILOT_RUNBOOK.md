# Carrier document and Carbon Annex isolated pilot

This guarded pilot validates R03 controls and the dependent R04 broker-handoff controls against PostgreSQL and real files. It creates synthetic
companies, shipment, carrier evidence, calculation snapshot and export documents. Never run it on
production or on a database that is not explicitly approved for retained synthetic rows.

## Required isolation

- Use a dedicated non-production database and uploads directory.
- Confirm `NODE_ENV` is not `production`.
- Apply all migrations through `025_r04_vn_customs_broker_handoff.sql`.
- Set the database name guard to the exact value returned by `SELECT current_database()`.

PowerShell example:

```powershell
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:carrier-document-pilot
```

## What a pass proves

The pilot verifies that:

- a shipment line inherits a non-legacy calculation snapshot and complete carbon provenance;
- B/L metadata reconciles its mode, parties, route, package count, gross weight, CBM, container and seal;
- changed file bytes fail confirmation even when the database still contains the original checksum;
- confirmation locks exact evidence bytes and stores a named append-only reconciliation;
- confirmed metadata cannot be edited/deleted and another tenant cannot read it;
- Carbon Annex is clearly supplementary and contains methodology/boundary/factor provenance;
- a changed shipment seal invalidates readiness; and
- an explicitly linked replacement version supersedes the old metadata and restores readiness.
- current issued R01/R02 files are pinned into a non-submittable R04 JSON handoff; and
- authority events require exact locked evidence, reject tampering/wrong evidence types and remain append-only.

The result is written to `artifacts/carrier-document-pilot/result.json` and
`artifacts/vn-customs-handoff-pilot/result.json`. CI retains the artifacts for
14 days. A pass proves technical controls only. It does not prove that a real carrier issued the file,
that a signature is genuine, or that the document is legally usable.

## Real-document gate

Before changing any readiness claim, a qualified operator must repeat the workflow using a real
carrier/forwarder document in non-production, verify issuer/authentication and original status, compare
all metadata with the carrier file and R01/R02, download and inspect the Carbon Annex, and record the
reviewer identity, decision, timestamp and checksums in the controlled release record.
