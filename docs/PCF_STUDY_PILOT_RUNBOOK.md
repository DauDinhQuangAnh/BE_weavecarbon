# R12 Product Carbon Footprint Study Pilot

## Purpose

This pilot verifies the limited internal product carbon footprint study workflow. It proves that the study is bound to a finalized calculation snapshot, reproduces the stored activity-data × emission-factor terms, controls source evidence, blocks unsupported comparative or verified claims, and records an append-only practitioner review.

It does not establish ISO certification, independent assurance, an EPD, PEF compliance, or permission to publish a comparative claim.

## Safety gate

Run only against a disposable PostgreSQL database. The script refuses production mode and requires all three explicit settings:

```text
ALLOW_CARRIER_DOCUMENT_PILOT=1
CARRIER_PILOT_DATABASE=<exact current_database() value>
CARRIER_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA
```

Apply `DATABASE_SCHEMA.sql` and every migration through `035_r12_pcf_study_dossier.sql` before running:

```text
npm run test:pcf-study-pilot
```

## Expected evidence

The command writes the cumulative result to `artifacts/pcf-study-pilot/result.json`. A passing R12 result includes:

- `productionDataTouched: false` and `isolatedDatabaseConfirmed: true`;
- an incomplete/comparative study blocked from approval;
- an unsupported assurance reference blocked from verified language;
- a passing internal study whose reported and reproduced totals match;
- input, result, calculation and evidence hashes retained through practitioner review;
- tenant isolation and append-only mutation rejection.

CI uploads the JSON artifact for 14 days. Retain the artifact hash with the compliance tracker checkpoint.
