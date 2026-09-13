# R10 GPSR technical-file isolated pilot

This guarded pilot verifies internal product-safety dossier controls for Regulation (EU) 2023/988. It does not certify
product safety, provide legal advice, notify an authority or establish that a product may be placed on the EU market.

## Preconditions

- Use a disposable, explicitly named non-production PostgreSQL database and isolated uploads directory.
- Load `DATABASE_SCHEMA.sql`, then apply every migration through `033_r10_gpsr_technical_file.sql`.
- Never point the pilot variables at production or a shared staging database.

## Run

Set `NODE_ENV=test`, `DB_NAME` and `CARRIER_PILOT_DATABASE` to the same isolated database name. Set
`ALLOW_CARRIER_DOCUMENT_PILOT=1` and
`CARRIER_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA`, then run:

```text
npm run test:gpsr-technical-file-pilot
```

The cumulative pilot must prove that:

- a file missing product-specific risk analysis or Article 19 distance-sale information cannot be approved;
- product/batch identity, manufacturer, importer and EU responsible-person contacts are retained;
- hazards, initial/residual risk, mitigations, standards/tests, warnings and locked evidence are checksum-bound;
- approval is restricted to `product_safety_reviewer`, the latest revision and current evidence bytes;
- the file, review and post-market ledgers are immutable and tenant-isolated;
- a serious/death incident is visibly flagged for Safety Business Gateway assessment;
- a claimed Gateway notification is rejected unless an external reference and locked receipt evidence are supplied;
- post-market summaries explicitly prohibit consumer personal data.

The machine-readable result is written to `artifacts/gpsr-technical-file-pilot/result.json`; CI retains it as technical
evidence. A release still needs product-specific validation by the responsible economic operators and a qualified
product-safety reviewer. Any legally required Gateway notification, authority response, consumer notice, corrective
action or recall must happen outside WeaveCarbon first and only then be recorded with genuine external evidence.
