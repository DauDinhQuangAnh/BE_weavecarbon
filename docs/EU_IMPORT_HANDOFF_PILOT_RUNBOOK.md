# EU import declarant-handoff isolated pilot

This guarded R05 pilot validates WeaveCarbon's internal EU import handoff together with its R01/R02/R03 dependencies.
It does **not** connect to an EU national customs system, create a SAD, submit a customs declaration, obtain an MRN or
prove authority acceptance. The internal schema `weavecarbon.eu-import-declarant-handoff@1.0.0` references EUCDM
7.0.11 and must still be mapped to the exact destination/declarant schema before real use.

## Required isolation

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production`.
- Apply all migrations through `027_r05_eu_import_declarant_handoff.sql`.
- Set the database-name guard to the exact value returned by `SELECT current_database()`.
- Never use authentic credentials, authority endpoints or production shipment data.

PowerShell example:

```powershell
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:eu-import-handoff-pilot
```

The pilot reuses the guarded R03/R04 fixture because R05 cannot pass without current issued Commercial Invoice and
Packing List files plus a confirmed carrier document that all reconcile to the same shipment.

## What a pass proves

- the importer/declarant EORI, Member State, procedures, valuation, taxes/controls and exact target-schema identity are checked;
- every line has a 10-digit TARIC code preserving the controlled HS6 heading;
- a classification edit clears approval and an unchanged second action is required to confirm TARIC;
- current R01/R02 file bytes and R03 evidence are re-read and verified before generation and issue;
- JSON remains `notForDirectSubmission=true`, `authorityStatus=NOT_SUBMITTED` and identifies EUCDM 7.0.11;
- issue requires a named `eu_import_declaration_reviewer` decision bound to exact source/payload/file hashes;
- an authority event rejects the wrong evidence type and tampered evidence bytes;
- a valid external event is append-only, tenant-isolated and pinned to exact issued-document/evidence checksums.

The shared pilot writes `artifacts/eu-import-handoff-pilot/result.json`. CI retains it for 14 days.

## What a pass does not prove

- that the configured destination schema is accepted by a Member State or declarant;
- that TARIC, procedure, valuation, duty, VAT, restrictions, preference or guarantee decisions are legally correct;
- that a declaration was submitted, accepted or released;
- that a qualified EU import specialist reviewed an authentic shipment.

## Real declarant gate

Obtain the exact national/declarant schema ID and version, code lists, validation rules and acknowledgement samples.
On isolated staging, map the internal envelope and process one appropriately protected real shipment with a named
EU import specialist. Compare every field to R01/R02/R03, retain the declarant/authority response as locked exact bytes,
and record reviewer identities, timestamps, document IDs and SHA-256 values. The generated handoff must remain
`NOT_SUBMITTED`; only an evidence-backed external event may display a declarant or authority result.
