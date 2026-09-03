# WP-CARB5 - Immutable Calculation Snapshots

Work package status: PASS

Calculation history status: VERSIONED, REPRODUCIBLE AND IMMUTABLE AFTER FINALIZATION

## Scope and outcome

Every new backend carbon calculation now records the information required to explain
and reproduce the result at a later date:

- rule engine version;
- methodology version;
- factor registry version, including a SHA-256 digest of the canonical registry;
- GWP basis;
- calculation timestamp;
- stable SHA-256 of canonical normalized input;
- exact normalized input and output;
- exact factors and values used; and
- important calculation assumptions.

Product recalculation appends a new `product_assessment_snapshots` row with the next
version. It never overwrites a finalized calculation. All product, report, DPP,
passport, export/compliance and audit readers use
`latest_product_assessment_snapshots`, so adding history does not duplicate current
API/export rows.

## Migration

`013_immutable_calculation_snapshots.sql` is additive and transactional:

1. Adds reproducibility metadata to product snapshots and direct
   `carbon_calculations` records.
2. Backfills existing rows with explicit `legacy-unversioned` / `legacy:<uuid>`
   markers and `is_legacy = true`; no existing payload or carbon total is deleted.
3. Replaces the old single-column product uniqueness rule with unique
   `(product_id, version)` history.
4. Creates the latest-snapshot view and supporting index.
5. Adds PostgreSQL triggers that reject UPDATE on finalized calculation rows with
   SQLSTATE `55000`.

The migration intentionally permits lifecycle DELETE/cascade behavior already exposed
by the product API. Immutability here means a finalized calculation cannot be edited
or silently overwritten; deletion remains an explicit product/company lifecycle act.

## Write and read boundaries

`src/modules/carbon/calculationSnapshot.js` owns canonical serialization, hashing,
metadata capture and append-only product snapshot insertion. Product create, update,
publish/recalculation and bulk import use this single boundary.

Transactions lock an existing product before choosing the next version. The database
unique constraint is the final guard against duplicate `(product_id, version)` pairs.

Direct `/carbon-calculations` writes store the same complete metadata and are finalized
at insert time. Their finalized rows are protected by the same database policy.

Authority references exposed to clients and official artifacts now include:

- `calculationId`, `calculationVersion`, `calculatedAt`;
- `engineVersion`, `methodologyVersion`, `factorRegistryVersion`;
- `gwpBasis`, `canonicalInputHash`; and
- `legacy`.

## Verification evidence

- Pre-change backend baseline: 69 suites / 467 tests passed.
- Pre-change frontend baseline: 28 files / 128 tests passed, 1 skipped.
- Snapshot builder tests prove canonical hashes are key-order independent, factor
  registry identity is stable, exact factors/assumptions are captured, and
  recalculation SQL is INSERT-only.
- Product persistence tests prove create/update/publish return the newly appended
  calculation identity/version.
- Official output tests prove calculation metadata follows the authoritative result.
- The backend integration workflow seeds a pre-migration legacy row, applies all real
  PostgreSQL migrations, then proves legacy backfill, finalized-row rejection and
  latest-version selection in a transaction.
- Search verification finds no application UPDATE of
  `product_assessment_snapshots`; only append and latest-view reads remain.

## Compatibility and risks

- Carbon numerical logic and golden fixture values are unchanged.
- Historical rows do not claim versions that were never recorded; they remain usable
  and are explicitly marked legacy.
- A future factor registry change will produce a different registry digest even if a
  human-readable factor label stays the same.
- Snapshot payload size increases because exact factors and assumptions are retained.
  This is intentional audit data; storage monitoring remains operational follow-up.
- The migration rewrites existing snapshot rows during metadata backfill. Deployment
  must retain the normal pre-deploy database backup.

## Rollback

Application rollback alone is unsafe after more than one calculation version exists,
because the pre-WP-CARB5 application expects one mutable snapshot per product.

Safe rollback order:

1. Stop writes and preserve a database backup containing the new history.
2. Restore the pre-deploy database backup.
3. Restore/redeploy the backend and frontend artifacts preceding WP-CARB5.

If the migration has completed but no post-deploy writes occurred, a DBA may instead
drop the two immutability triggers and latest-snapshot view, remove the new constraint,
restore the old unique `product_id` constraint, and then deploy the previous artifact.
Do not collapse version history without a separate backup.
