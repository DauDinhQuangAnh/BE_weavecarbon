# Audit Pack isolated pilot runbook

This runbook verifies the R14 Audit/evidence Pack against a real PostgreSQL database without using production data.
It is a technical gate, not legal approval and not external assurance.

## Safety boundary

- Never point this pilot at the production database.
- The script refuses `NODE_ENV=production` and requires three explicit environment confirmations.
- It writes uniquely named synthetic companies, users, a product, calculation snapshots, evidence, reports, reviews and
  issuances. Completed records are intentionally immutable, so run it only on an ephemeral CI database or a staging clone
  that is approved to retain synthetic pilot rows.
- Evidence and generated ZIP files use a temporary operating-system directory and are deleted after the run.
- The script does not restart services, deploy code, submit to an authority, or change `assuranceStatus` from
  `not_verified`.

## Prerequisites

1. Load `DATABASE_SCHEMA.sql` into an isolated PostgreSQL database.
2. Run the legacy fixture and every migration through migration 020.
3. Configure the normal `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` variables.
4. Confirm that `DB_NAME` is not production and that synthetic immutable rows are acceptable.

The backend CI integration job performs steps 1-3 automatically on a disposable PostgreSQL 16 service.

## Run

PowerShell:

```powershell
$env:ALLOW_AUDIT_BUNDLE_PILOT = '1'
$env:AUDIT_PILOT_CONFIRM_ISOLATED = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA'
$env:AUDIT_PILOT_DATABASE = $env:DB_NAME
npm run test:audit-bundle-pilot
```

Bash:

```bash
ALLOW_AUDIT_BUNDLE_PILOT=1 \
AUDIT_PILOT_CONFIRM_ISOLATED=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_DATA \
AUDIT_PILOT_DATABASE="$DB_NAME" \
npm run test:audit-bundle-pilot
```

## What must pass

The pilot checks all of the following against PostgreSQL and real generated ZIP bytes:

1. Migrations 019/020 tables exist.
2. The carbon engine creates an authoritative, immutable snapshot with contribution terms.
3. Synthetic period-bound evidence maps explicitly to every calculation row and every factor version.
4. The existing reports queue is used; no second queue is introduced.
5. Bundle generation stores a ZIP only after file size and SHA-256 verification.
6. `manifest.json`, `calculation.json`, the evidence index and every evidence file can be reopened and rehashed.
7. A completed but unreviewed bundle is blocked.
8. An open blocking QA exception prevents issue.
9. A later approved review with resolved blockers moves the bundle to `ready`.
10. Internal issue moves it to `issued` while assurance remains `not_verified`.
11. A different company cannot read the bundle.
12. PostgreSQL rejects changes to a completed bundle, pinned evidence, review and issuance.
13. Creating a newer draft does not supersede the issued version.
14. Issuing the newer version changes the older derived lifecycle to `superseded`.

## Evidence artifact

The run writes `artifacts/audit-pilot/result.json`. CI uploads it for 14 days. A passing result records bundle IDs,
manifest/bundle checksums, sizes and every gate above. It contains synthetic identifiers only.

For a real staging pilot, separately record the output checksum, operator/reviewer identity and decision in
`docs/EXPORT_REPORT_MASTER_TRACKER.md`. Automated success alone does not promote R14 to `READY_TO_ISSUE`.

## Production release boundary

Do not merge/deploy based only on this pilot. The normal production gates still require a verified database/uploads backup,
staging migration, restore evidence, a human review of a representative real-data pack, reviewed pull requests, CI success
and post-deploy health/download checks. An external-assurance workflow and signed/expiring share delivery remain separate
unfinished work.
