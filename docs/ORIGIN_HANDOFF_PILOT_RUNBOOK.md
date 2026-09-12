# EVFTA origin-support isolated pilot

This guarded R07 pilot validates WeaveCarbon's internal BOM/rule/evidence handoff. It does **not** determine
preferential origin, create or issue EUR.1, sign an origin declaration, obtain authority endorsement or grant tariff
preference. The output remains an internal `weavecarbon.evfta-origin-support-handoff@1.0.0` dataset for a qualified
origin specialist.

## Required isolation

- Use a dedicated non-production PostgreSQL database and uploads directory.
- Confirm `NODE_ENV` is not `production`.
- Apply every migration through `029_r07_evfta_origin_support_handoff.sql`.
- Set the database-name guard to the exact value returned by `SELECT current_database()`.
- Use only synthetic companies, identities, BOM data and supplier evidence.

PowerShell example:

```powershell
$env:DB_NAME='weavecarbon_staging'
$env:UPLOADS_DIR='D:\isolated\weavecarbon-r07-uploads'
$env:ALLOW_CARRIER_DOCUMENT_PILOT='1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED='I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE='weavecarbon_staging'
npm run test:origin-handoff-pilot
```

The fixture is cumulative and reruns the controlled R01-R06 workflows before R07.

## What a pass proves

- preference is explicitly enabled on a Vietnam-to-EU shipment;
- a confirmed HS line is connected to one versioned Annex-II rule assessment;
- required manufacturing operations and ex-works/non-originating values reconcile;
- every BOM material has identity, origin status and locked SHA-256 evidence;
- changed evidence bytes block both generation and immutable issue;
- JSON states `NOT_PROOF_OF_ORIGIN`, `NOT_ISSUED` and `NOT_GRANTED` and contains no fabricated EUR.1 number;
- issue requires the exact checksum-bound `origin_specialist_reviewer` decision;
- the profile and reconciliation remain tenant-isolated.

The result is written to `artifacts/origin-handoff-pilot/result.json`; CI retains it as a test artifact.

## What a pass does not prove

- that the HS classification or selected product-specific rule is legally correct for a real product;
- that tolerance, cumulation or supplier declarations are sufficient for an authentic consignment;
- that an exporter is entitled to use a particular proof route or wording;
- that a competent authority, customs office or importer accepts the claim.

## Real specialist gate

On isolated staging, use a protected real BOM and authentic supplier evidence. A qualified origin specialist must verify
the effective EVFTA rule, manufacturing record, material status, value calculation, cumulation/tolerance, territoriality
and non-alteration evidence. Record the named review and exact hashes. Any legally performed EUR.1 application or origin
declaration stays outside this internal handoff until a separately designed exporter/authority workflow is approved.
