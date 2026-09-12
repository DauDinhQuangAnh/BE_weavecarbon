# ICS2/ENS filer-handoff isolated pilot

This guarded R06 pilot validates WeaveCarbon's internal ICS2 filing handoff together with its R01/R02/R03 transport
dependencies. It does **not** create or submit an Entry Summary Declaration (ENS), connect to the ICS2 Shared Trader
Interface, complete conformance testing, obtain an MRN or prove customs registration/risk clearance. The internal schema
`weavecarbon.ics2-filing-handoff@1.0.0` is a controlled filer/ITSP handoff only and must be mapped to the recipient's exact
accepted ICS2 technical package before real use.

## Required isolation

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production`.
- Apply all migrations through `028_r06_ics2_filing_handoff.sql`.
- Set the database-name guard to the exact value returned by `SELECT current_database()`.
- Never use authentic credentials, STI endpoints, production shipment data or production EORI identities.

PowerShell example:

```powershell
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:ics2-handoff-pilot
```

The shared fixture is intentionally cumulative: R06 cannot pass unless the shipment has reconciled goods/packages and a
confirmed, current carrier document from R03. The R04 and R05 checks also run so later changes cannot silently regress the
earlier controlled handoffs.

## What a pass proves

- the selected Annex B F-dataset is compatible with the selected transport mode;
- sender/declarant EORI, first-entry office/country, timezone-aware ETA, itinerary and active conveyance are checked;
- the master transport document matches the controlled shipment carrier reference;
- every goods line is allocated exactly once to a lowest-level house consignment;
- house gross mass/package count reconcile to goods lines and physical packages;
- each goods item has HS6+ and a specific description; known generic descriptions are blocked;
- JSON remains `notForDirectSubmission=true`, `authorityStatus=NOT_SUBMITTED` and contains no fabricated MRN;
- issue requires a named `ics2_filing_reviewer` decision bound to exact source/payload/file hashes;
- an authority event rejects the wrong evidence type and tampered evidence bytes;
- a valid external event is append-only, tenant-isolated and pinned to exact issued-document/evidence checksums.

The shared pilot writes `artifacts/ics2-handoff-pilot/result.json`. CI should retain it as a test artifact.

## What a pass does not prove

- that the selected F-dataset contains every field for the actual transport/business model;
- that the target filer/ITSP accepts the configured schema, namespace, code lists or technical-package version;
- that ICS2 conformance testing has passed;
- that an ENS was submitted, registered, risk-assessed, amended or invalidated;
- that a carrier/filer or customs specialist approved an authentic shipment.

## Real filer gate

Obtain the exact filer/ITSP schema ID and version, ICS2 technical-package version, code lists, validation rules, transport
and filing arrangement, plus acknowledgement/rejection samples. After required conformance testing, map the internal
envelope and process one appropriately protected real shipment on isolated staging with a named filing specialist. Compare
master/house contracts, every goods line and package total to R01/R02/R03, retain filer/authority responses as locked exact
bytes, and record reviewer identities, timestamps, document IDs and SHA-256 values. The generated handoff must remain
`NOT_SUBMITTED`; only an evidence-backed external event may display a filer or authority result.
