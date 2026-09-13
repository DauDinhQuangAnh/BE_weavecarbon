# R17 EU textile, textile-related and footwear EPR core pilot

## Purpose and legal boundary

This guarded synthetic pilot tests EU-core planning and reconciliation controls derived from Directive (EU) 2025/1892. It does not register a producer, appoint a real producer responsibility organisation, submit a national return, determine a national fee, or prove payment.

National transposition, authority, register, reporting schedule, fee-modulation and authorised-representative details must be maintained as dated Member-State adapters. Internal approval never creates an external lifecycle status.

## Controls exercised

- Article 3(4b) producer-role and exclusion screening;
- Annex IVc CN-code coverage, including the 6301 10 00 exclusion;
- Article 22b identity, trade/tax identifiers, product codes and truth statement;
- producer responsibility organisation identity and written-mandate evidence;
- Member-State source/version/status and representative-rule recording;
- microenterprise transition date;
- exact CN/unit quantity and net-weight reconciliation to confirmed, period-scoped shipment lines;
- immutable input, shipment, result and evidence snapshots;
- named `eu_epr_specialist` review;
- typed authority/PRO receipt evidence for registration, membership, report submission and fee payment events;
- tenant isolation and append-only history.

## Isolated local execution

Load `DATABASE_SCHEMA.sql` and all migrations into a fresh non-production PostgreSQL database, then run:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_CARRIER_DOCUMENT_PILOT = '1'
$env:CARRIER_PILOT_CONFIRM_ISOLATED = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:CARRIER_PILOT_DATABASE = '<exact-isolated-database-name>'
$env:DB_NAME = '<exact-isolated-database-name>'
$env:UPLOADS_DIR = '<isolated-upload-directory>'
npm run test:eu-textile-epr-pilot
```

The database-name guard must match `current_database()` exactly. The pilot refuses production mode.

## Expected evidence

`artifacts/eu-textile-epr-pilot/result.json` must report `status: passed`, `productionDataTouched: false` and the three `r17_...` checks. Store its SHA-256 digest with release evidence.
