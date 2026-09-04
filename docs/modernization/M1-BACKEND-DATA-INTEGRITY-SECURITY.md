# Macro Phase M1 - Backend Data Integrity and Security

Status: PASS

Work packages: CARB6, CARB7, D1, D2, SEC1, SEC2, SEC3

## Outcome

M1 makes emission factors durable and queryable, enforces canonical physical units for new authoritative calculations, attaches calculation snapshots to an explicit tenant, makes evidence/audit multi-writes atomic, and hardens authorization, uploads, rate limits and production error handling.

Public compatibility is preserved. Existing calculation fixtures still use the compatibility validation mode; every newly finalized authoritative calculation uses strict physical validation.

## CARB6 - versioned factor registry and provenance

- The current JSON factor catalog is validated at process startup and frozen in memory.
- Its registry version is content-addressed as `factors-v1:<sha256>`; a changed factor catalog produces a new registry identity instead of silently changing historical meaning.
- Migration `014_m1_factor_registry_and_snapshot_tenant.sql` creates immutable `emission_factor_registries` and `emission_factor_versions` tables. The separate name preserves the legacy `emission_factors` reference table used by export-market compatibility flows. Update/delete triggers protect published history.
- Migration execution atomically synchronizes the complete current catalog and aborts on hash or factor-count mismatch.
- Authenticated B2B/platform-admin consumers can query registry metadata and factor provenance at:
  - `GET /api/carbon-factors/registries`
  - `GET /api/carbon-factors`
  - `GET /api/carbon-factors/:factorId`
- Provenance includes source name/URL/year, geography, boundary, validity, quality, uncertainty, proxy status, unit and GWP basis.
- Finalized snapshots retain their exact `factor_registry_version` and embedded factor manifest, so later registry releases cannot alter historical results.

## CARB7 - units, validation and rounding

Canonical quantities are declared in `src/modules/carbon/core/units.js`:

| Quantity | Canonical unit |
| --- | --- |
| Mass | kg |
| Energy | kWh |
| Fuel volume | L |
| Distance | km |
| Freight activity | tonne.km |
| Emissions | kgCO2e |
| Material factor | kgCO2e/kg |
| Energy factor | kgCO2e/kWh |
| Process intensity | kWh/kg |
| Transport factor | kgCO2e/tonne.km |

Supported incoming conversions include g/kg/tonne, Wh/kWh/MWh, m/km/mi, mL/L and tkm/tonne.km. Unsupported, negative or non-finite values fail predictably.

Rounding policy:

- Keep full JavaScript `Number` precision through intermediate calculations.
- Round per-product results once at the output boundary to 3 decimals in kgCO2e.
- Round batch totals once at the output boundary to 2 decimals in kgCO2e.
- Persist the exact factor value and unit used; never infer a factor unit after calculation.

Strict authoritative validation rejects non-positive quantities, negative physical values, invalid BOM/energy percentages, invalid yields, invalid transport distance and dimensional factor mismatches. Golden compatibility fixtures remain unchanged.

## D1 - hot queries and indexes

Migration `015_m1_hot_query_indexes.sql` creates indexes concurrently and only for mapped production query shapes:

| Query shape | Index |
| --- | --- |
| Active products by tenant/update time | `idx_products_company_active_updated` |
| Latest calculation snapshot by tenant/product/version | `idx_product_snapshots_company_product_version` |
| Evidence feed by tenant/creation time | `idx_evidence_company_created` |
| Supplier requests by tenant/status/time | `idx_supplier_requests_company_status_created` |
| Carbon history by tenant/time | `idx_carbon_calculations_company_created` |
| Product batches by tenant/update time | `idx_product_batches_company_updated` |

`npm run db:audit-hot-queries` records PostgreSQL JSON plans, estimated rows, node types and selected indexes for all six shapes. Existing equivalent indexes were not duplicated. Snapshot joins and reads now include tenant ownership, and the dashboard tracked-products CTE no longer uses `SELECT *`.

## D2 - transactions and database behavior

- Pool size, connect/idle/statement/query timeouts and application name are explicit and environment-bounded.
- `withTransaction` guarantees `BEGIN`, `COMMIT`, rollback on failure and client release.
- Evidence create+audit and lock+audit are one database transaction.
- Evidence document/invoice deletion is one database transaction; the local file is removed only after commit.
- Factor registry/catalog synchronization is one transaction.
- Product writes and immutable snapshot creation continue within their existing product transaction.
- Payment completion already locks the session `FOR UPDATE`; duplicate callbacks return without repeating subscription writes.

Rollback tests cover failed transaction rollback/release. Database startup now requires the factor tables and tenant-owned snapshot column, preventing a partially migrated API from serving traffic.

## SEC1 - ownership and integrity matrix

| Resource | Ownership rule | Enforcement |
| --- | --- | --- |
| Company memberships | user + company | Active membership reloaded from DB for every authenticated request |
| Products/batches/shipments/reports/suppliers/data gaps | company | Existing repository predicates plus authenticated company context |
| Calculation snapshots | company + product | Non-null `company_id`, composite FK to `(products.id, products.company_id)`, tenant-scoped reads/writes |
| Evidence and linked invoices | company | Tenant-scoped lookup/create/update/delete and transaction checks |
| Subscription/payment sessions | company | Tenant check and row lock during payment resolution |
| Emission factor registry | global, read-only reference data | Authenticated reads; immutable DB catalog; only migration sync writes |
| Global AI/RAG runtime configuration | global platform operation | Explicit platform-admin-only exception; company administrators cannot mutate it |

Migration 014 backfills snapshot ownership from the product table without deleting rows and aborts if any orphan/cross-tenant row exists. `npm run test:m1-integrity` checks zero null/cross-tenant snapshots and the exact current factor count.

## SEC2 - authorization

- A tenant identifier from a JWT is accepted only when an active database membership exists for that user and company.
- The request records `companyRole` and membership status from the database, not from stale token claims.
- Company roles are explicit: admin = read/write/manage/billing, member = read/write, viewer = read-only.
- Viewer mutations on tenant resources fail with `403 TENANT_PERMISSION_DENIED`.
- Platform-level global AI/RAG configuration requires the platform `admin` role.
- Negative tests cover stale cross-tenant token context and viewer mutation denial.

## SEC3 - application hardening

- Evidence, RAG, B2C image and compliance-document uploads are size-limited, rate-limited and validated by extension, MIME and file signature/package structure.
- Rejected disk uploads are deleted immediately.
- Expensive-operation limits key authenticated traffic by tenant+user, avoiding one shared proxy IP bucket.
- API request bodies are bounded; URL-encoded parameter count is bounded.
- Production CORS no longer implicitly trusts localhost.
- Access tokens default to 15 minutes; refresh tokens default to 30 days.
- Production 5xx responses do not expose internal messages, details or stack traces.
- Logs redact credentials/tokens/payment hashes and strip query strings from access/error/slow-request paths.
- VNPAY payment completion is row-locked and idempotent; duplicate-callback regression coverage verifies no repeated upgrade mutation.

## Verification evidence

- Backend `npm run verify:full`: PASS.
- Backend Jest: 81 suites, 504 tests passed.
- Syntax: 218 JavaScript files passed.
- OpenAPI: 133 paths, 169 documented operations, 168 mounted runtime operations matched.
- Module boundaries: 9 modules, 1 reference implementation, 0 violations.
- Frontend OpenAPI snapshot/generated types: synchronized and current.
- Frontend `npm run verify:full`: PASS; 28 files, 128 tests passed, 1 skipped.
- Local PostgreSQL migration execution was unavailable because no local PostgreSQL server was listening. The required PostgreSQL 16 migration, integrity, query-plan and health checks run in Backend CI before deployment.

## Deployment and rollback

Deployment order is backend migration/startup first, then frontend contract deployment. Migrations are additive and preserve existing snapshots.

For application rollback, revert the M1 application commit while leaving additive tables/columns in place. Do not drop snapshot ownership data during an incident. Index rollback, if required after evidence collection, uses explicit `DROP INDEX CONCURRENTLY` for only the six M1 indexes. Factor catalog and snapshot ownership constraints should be removed only through a separately reviewed migration.
