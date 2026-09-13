# R11 REACH/SVHC dossier isolated pilot

This guarded pilot verifies an internal, limited article/substance control workflow. It does not create a generic
"REACH certificate", provide legal advice, submit to ECHA/SCIP or prove compliance with every applicable restriction.

## Preconditions and run

- Use a disposable named PostgreSQL database and isolated uploads directory.
- Load `DATABASE_SCHEMA.sql`, then apply every migration through `034_r11_reach_svhc_dossier.sql`.
- Set `NODE_ENV=test`, `DB_NAME` and `CARRIER_PILOT_DATABASE` to the same database.
- Set `ALLOW_CARRIER_DOCUMENT_PILOT=1` and
  `CARRIER_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA`.
- Run `npm run test:reach-svhc-dossier-pilot`.

The cumulative pilot must prove that source-version drift, product-only aggregation, missing safe-use information and
unsupported evidence are blocked; Article 33/7 and SCIP assessments remain separate; Annex XVII results use an explicit
entry, scope, limit, unit, method and homogeneous-material result; approval requires the newest revision, a named
`chemical_compliance_reviewer` and current evidence bytes; tenant isolation and immutability hold; consumer requests get
a 45-day deadline without personal data; and ECHA/SCIP or outbound communication claims require an external reference and
locked proof.

The result is written to `artifacts/reach-svhc-dossier-pilot/result.json`. A release still requires a current full-list and
restriction screen, authentic supplier/SDS/laboratory evidence, article-level assessment, destination-language safe-use
content and a qualified chemical specialist. Any notification or communication must be performed by the responsible
actor outside WeaveCarbon before its receipt is recorded.
