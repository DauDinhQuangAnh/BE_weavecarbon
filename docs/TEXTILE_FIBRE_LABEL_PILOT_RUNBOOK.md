# R08 EU textile fibre-label isolated pilot

This guarded pilot verifies the internal R08 label controls. It does not create certified translations, approve final
artwork, provide legal advice or establish that a product may be placed on any market.

## Preconditions

- Use a disposable, explicitly named non-production PostgreSQL database and isolated uploads directory.
- Load `DATABASE_SCHEMA.sql`, then apply every migration through `032_r08_textile_fibre_label.sql`.
- Never point the pilot variables at production or a shared staging database.

## Run

Set `NODE_ENV=test`, `DB_NAME` and `CARRIER_PILOT_DATABASE` to the same isolated database name. Set
`ALLOW_CARRIER_DOCUMENT_PILOT=1` and
`CARRIER_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA`, then run:

```text
npm run test:textile-fibre-label-pilot
```

The cumulative pilot must prove that:

- invalid Annex-I fibre codes, missing animal-origin handling and missing online display are blocked;
- a main lining below 30% still carries a separate fibre composition;
- market-language text and an operator confirmation are recorded without claiming machine translation is certified;
- approval is restricted to `textile_label_reviewer`, the latest revision and current locked evidence;
- specifications and reviews are immutable, checksum-bound and tenant-isolated;
- Annex IV–VI derogations and uncertain scope route to specialist review.

The machine-readable result is written to `artifacts/textile-fibre-label-pilot/result.json`. CI retains this file as
technical evidence. A release still needs a representative physical/online artwork review by the responsible economic
operator and a qualified textile-labelling specialist for each destination language and product exception.
