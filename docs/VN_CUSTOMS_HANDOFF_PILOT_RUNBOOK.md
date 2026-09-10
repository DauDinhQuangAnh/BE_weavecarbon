# Vietnam customs broker-handoff isolated pilot

This guarded pilot validates the R04 technical controls together with their R01/R02/R03 dependencies.
It does **not** connect to VNACCS and does not produce a customs declaration. The output schema
`weavecarbon.vn-export-broker-handoff@1.0.0` is an internal, versioned interchange envelope that a
named customs broker must map to and approve against its exact target schema.

## Required isolation

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production`.
- Apply all migrations through `026_r04_export_document_json_format.sql`.
- Set the database-name guard to the exact value returned by `SELECT current_database()`.
- Never use authentic credentials, real authority endpoints or production shipment data in this pilot.

PowerShell example:

```powershell
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:vn-customs-handoff-pilot
```

The R04 pilot intentionally reuses the guarded R03 fixture because a broker handoff is not valid unless
the current issued Commercial Invoice, current issued Packing List and confirmed carrier document all
reconcile to the same shipment snapshot.

## What a pass proves

- an 8-digit Vietnam tariff line, invoice value, currency/exchange rate, weights, packages and carrier data reconcile;
- current issued R01/R02 files are pinned by document ID, version, payload SHA-256 and file SHA-256;
- those supporting files and carrier evidence are re-read and checked byte-for-byte before R04 generation and issue;
- JSON remains marked `notForDirectSubmission=true` and `authorityStatus=NOT_SUBMITTED`;
- issue requires a named `customs_declaration_reviewer` approval bound to the exact payload/file/source hashes;
- an `authority_accepted` event rejects the wrong evidence type and tampered authority-response bytes;
- a valid external event pins the issued handoff and authority evidence checksums, is append-only and tenant-isolated.

The result is written to both `artifacts/carrier-document-pilot/result.json` and
`artifacts/vn-customs-handoff-pilot/result.json`. CI retains each artifact for 14 days.

## What a pass does not prove

- that the configurable broker target schema is an accepted VNACCS import format;
- that any data was submitted to VNACCS or accepted/released by Vietnam Customs;
- that the synthetic HS classification, procedure code, tax treatment or permit decision is legally correct;
- that a broker, customs specialist or authority reviewed the real shipment.

## Real broker gate

Before changing R04 from `PARTIAL`, obtain the broker's exact schema/version, code lists, validation rules
and sample acknowledgements. In non-production, map the internal envelope, process one authentic but
appropriately protected shipment with a named customs specialist, compare every field to R01/R02/R03,
and retain the broker/authority response as a locked exact file. Record reviewer identities, timestamps,
document IDs and all SHA-256 values in the controlled release record. Only an evidence-backed external
event may display an authority result; the generated handoff itself must stay `NOT_SUBMITTED`.
