# WP-CARB3 - Server-Authoritative Carbon Persistence

Work package status: PASS

Carbon authority status: BACKEND AUTHORITATIVE FOR NEW/UPDATED/FINALIZED PRODUCT DATA

## Scope and outcome

The WP-CARB2 pure core now owns every carbon value persisted through these write paths:

- product assessment create;
- product assessment update;
- draft-to-published finalization;
- product bulk import; and
- standalone `POST /carbon-calculations` persistence.

Frontend calculation remains available for instant preview. Its totals, scopes,
confidence, uncertainty and trace are treated as untrusted presentation data. The
backend rebuilds a normalized engine input from activity data and replaces the client
result before database or snapshot writes.

No database migration was required.

## Trust boundary

`src/modules/carbon/authoritativeCalculation.js` maps assessment fields to the exact
WP-CARB2 input contract:

- product mass and quantity;
- material composition and origin;
- accessory weights;
- production processes;
- energy mix, geography and transferred renewable attributes;
- destination market and transport legs.

Client-calculated fields are removed before snapshot persistence, including camelCase
and snake_case totals, breakdowns, scopes, confidence, proxy notes, quality,
uncertainty, factors and trace. The snapshot then receives only the server-built
`carbonInput` and server-produced `carbonResults`.

The products module declares its dependency on the carbon module explicitly. The core
remains isolated from products, HTTP and database concerns.

## Persistence behavior

| Write path | Authoritative behavior |
| --- | --- |
| Create product | Calculate before INSERT; store server stage totals/confidence and snapshot result. |
| Update product | Recalculate inside the transaction before UPDATE and snapshot replacement. |
| Publish draft | Recalculate the latest activity snapshot before status transition and shipment creation. |
| Bulk import | Recalculate every row; client total aliases are discarded. |
| POST carbon calculation | Requires `carbon_input`; supplied final totals are ignored. |

Create, update and publish responses now return `carbonResults`. The frontend mutation
adapter normalizes that response and the assessment state adopts it after save. This
keeps the current preview UX while ensuring the persisted and post-save value is the
server value.

## Contract changes

The versioned OpenAPI artifact now documents `carbon_input` as required for
`POST /carbon-calculations`. The previous `total_co2e` input is no longer accepted as
authority. Product `carbonResults` remains optional for compatibility but is marked as
a deprecated client preview that the server replaces.

The frontend OpenAPI snapshot and generated TypeScript transport definitions were
regenerated from the backend artifact.

## Verification evidence

- Backend trust-boundary focus: 10 suites / 42 tests passed.
- Backend full verification: 68 suites / 465 tests passed.
- Backend syntax: 205 files checked.
- Backend OpenAPI: 130 paths / 166 operations; 165 runtime operations matched.
- Backend architecture and ESLint: passed with zero errors.
- Backend runtime release build: passed.
- Frontend carbon/API focus: 3 files / 22 tests passed.
- Frontend full verification: 27 files / 126 tests passed, 1 skipped.
- Frontend typecheck and contract-current checks: passed.
- Frontend ESLint: zero errors and 21 pre-existing warnings; changed WP-CARB3 files add none.
- Frontend production build: passed and generated all 62 application routes.

Tampering tests submit totals such as `999999` and verify that database query
parameters, snapshots and mutation responses contain the independently computed
server result. An assessment integration test exercises raw payload normalization,
the real backend core and product persistence together. Separate tests cover update,
publish, bulk import and standalone calculation persistence.

## Compatibility and remaining risks

- Existing already-published legacy rows are not rewritten in this phase. New writes,
  updates and future publish transitions are authoritative. WP-CARB5 will label and
  version legacy snapshots explicitly.
- Frontend preview and backend use the same frozen V1 formula/factor contract. The
  frontend is no longer persistence authority, but its engine is retained until later
  call-site cleanup is proven safe.
- Reports, DPP and audit consumers are intentionally not migrated here. WP-CARB4 must
  prove that every official output reads the backend result and calculation identity.

## Next dependency

WP-CARB3 unlocks WP-CARB4. WP-CARB4 must trace reports, DPP/passport, compliance
exports and audit records, switch them to server-authoritative snapshot data, and add
cross-output calculation identity tests before any old authoritative frontend path is
removed.

## Rollback

Revert the matching backend and frontend WP-CARB3 commits together and redeploy both
previous artifacts. No database restore is required because there is no schema
migration. Product records written while WP-CARB3 is active contain valid WP-CARB2
results and remain readable by the previous version.
