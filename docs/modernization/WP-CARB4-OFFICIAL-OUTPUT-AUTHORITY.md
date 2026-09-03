# WP-CARB4 - Official Output Carbon Authority

Work package status: PASS

Carbon output status: SERVER-AUTHORITATIVE AND TRACEABLE

## Scope and outcome

All real-account report, DPP/passport, export/compliance and audit-pack paths now
consume persisted backend carbon results. Every product-backed official artifact carries
the same calculation reference:

- `source`: `product_assessment_snapshot`;
- `calculationId`: the server snapshot UUID;
- `calculationVersion`: the current server snapshot version; and
- `calculatedAt`: the server snapshot update timestamp.

Frontend calculation remains available only for interactive and explicitly demo
previews. It is not used as authority for a real-account download or DPP lock.

No database migration was required.

## Backend authority boundary

`src/modules/carbon/authorityReference.js` is the shared read boundary for official
consumers. It rebuilds the carbon result from the authoritative product columns plus
the server snapshot and returns the calculation reference. Client totals cannot
override this record.

Product list, detail and mutation responses expose `carbonAuthority`. Create, update
and draft-to-published transitions return the snapshot identity/version that owns the
returned carbon result. Product audit events record that same reference in structured
JSON notes.

## Official output behavior

| Output | Authoritative behavior |
| --- | --- |
| V2 report snapshot | Requires a product UUID; replaces client totals, breakdowns, scopes, charts and formulas with server snapshot values. |
| Report CSV/data export | Includes `calculation_id`, `calculation_version` and `calculated_at` for product rows. |
| Product/batch PDF | Reads persisted product totals and prints snapshot calculation reference(s). |
| Product detail XLSX | Refuses a real export without `carbonAuthority` and embeds the calculation ID/version. |
| DPP lock | Builds totals, result, hash and QR payload on the backend and embeds `carbonAuthority`. |
| Export XLSX documents | Uses backend product totals; the workbook audit reference contains calculation refs and bundle hash. |
| Buyer webhook | Includes a per-product authority reference and calculation manifest. |
| Market compliance | Product scope exposes authority and generated report metadata stores the calculation manifest. |
| Audit pack JSON/CSV | Uses backend totals and includes the same calculation ID/version in the payload and every CSV row. |
| Public passport | Receives product carbon result and authority through the backend product payload. |

## Frontend trust behavior

- Real report downloads wait for the canonical report payload returned by the backend.
  A persistence/authority failure blocks the download instead of falling back to a
  client-calculated artifact.
- Real DPP screens display the payload returned by the DPP lock endpoint. The local DPP
  builder is only called inside the demo branch.
- Report adapters, export summaries and audit packs prefer exact `carbonResults`
  values and carry `carbonAuthority` across formats.
- The standalone product-detail workbook requires and prints server authority.

## Contract changes

The OpenAPI product schema now exposes `CarbonAuthorityReference`.
`POST /reports/v2/snapshots` documents a required product UUID and states that carbon
fields are replaced by the server. `POST /export/dpp-locks` documents its product
reference contract and server authority behavior. The frontend OpenAPI snapshot and
generated transport types are synchronized.

## Verification evidence

- Pre-change baseline: backend 68 suites / 465 tests; frontend 27 files / 126 passed,
  1 skipped.
- Backend focused official-output verification: 7 suites / 55 tests passed.
- Backend final verification: 69 suites / 467 tests passed.
- Backend syntax: 207 files checked.
- Backend OpenAPI: 130 paths / 166 operations; 165 runtime operations matched.
- Backend architecture and ESLint: passed with zero errors.
- Frontend official-output focus: 2 files / 5 tests passed.
- Frontend final verification: 28 files / 128 tests passed, 1 skipped.
- Frontend typecheck and contract-current checks: passed.
- Frontend ESLint: zero errors and 21 pre-existing warnings.
- Backend release build and frontend production build: passed.

The cross-output backend test supplies tampered client totals and proves that report
and DPP outputs both contain the persisted total and exactly the same snapshot
identity/version. The frontend test proves report, export summary and audit JSON/CSV
share the exact server total and authority reference. Product workbook coverage proves
the calculation reference is physically embedded in the XLSX data.

Search evidence confirms there is no direct `computeSkuCarbonV2` call in application
components. Calls remaining in library code support demo or interactive preview paths;
real call sites either pass server authority or receive a canonical backend payload.

## Compatibility and remaining risks

- `product_assessment_snapshots` is still the existing mutable single-row snapshot.
  Its UUID plus incrementing version is sufficient to trace current official outputs,
  but historical immutable calculation versions are intentionally deferred to
  WP-CARB5.
- Existing artifacts generated before WP-CARB4 are not rewritten.
- Existing legacy products without an assessment snapshot are excluded from official
  product exports or rejected by authority-required output paths. WP-CARB5 will label
  and migrate legacy records explicitly.
- Market compliance file generation remains the existing report worker behavior; this
  phase makes its persisted report metadata traceable without redesigning that worker.

## Next dependency

WP-CARB4 unlocks WP-CARB5. WP-CARB5 must add immutable finalized calculation
snapshots, complete engine/methodology/factor registry versions, a stable canonical
input hash and explicit legacy markers.

## Rollback

Revert the matching backend and frontend WP-CARB4 commits together and redeploy both
previous artifacts. No database restore is required because WP-CARB4 has no schema or
data migration. DPP/report/audit records created while active remain valid JSON and are
backward-readable; older code simply ignores the additional authority fields.
