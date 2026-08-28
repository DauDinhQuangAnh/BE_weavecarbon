# WP-C1 OpenAPI Audit Against Runtime Routes

- Date: 2026-08-28
- Baseline commit: `f86aa84`
- Result: **PASS**
- Runtime/API behavior changes: none

## Baseline and scope

The pre-WP-C1 Swagger document contained five auth paths. Runtime inspection of the mounted Express routers found 165 operations across 129 API paths. The frontend contract audit scanned active TypeScript/TSX consumers rather than attempting to redesign unused or internal routes.

WP-C1 treats the mounted Express router registry as the route source of truth. Existing detailed auth JSDoc annotations remain authoritative where present and are merged with generated runtime coverage rather than discarded.

## Implemented contract

- `src/config/apiRoutes.js` is the shared registry used by both Express mounting and OpenAPI generation, eliminating the previous duplicated route list.
- OpenAPI 3.0.3 now contains 130 paths and 166 operations: all 165 mounted Express operations plus `/health`.
- Every operation has a unique `operationId`, tag, success/error responses, path parameters, security declaration and transport content type.
- Browser-public auth/payment/contact/passport flows explicitly override global bearer security; protected operations retain `bearerAuth`.
- Multipart operations document binary file input. Report/document/template/image downloads document binary, CSV or spreadsheet responses instead of JSON.
- Common success and error envelopes match `src/utils/http.js` and `src/middleware/errorHandler.js`.
- Products and company-members have concrete representative request/response schemas and examples, including actual pagination and snake_case member fields.
- Other domain payloads remain structurally open (`additionalProperties`) where a narrower schema could not be proven without fabricating a contract. Paths, methods, parameters, envelopes and media types remain generation-safe; domain specialization and adapters proceed incrementally in WP-C2.

## Frontend mismatch found

The audit-trail page called the nonexistent `/company-members` path and expected camelCase member fields. The backend exposes `/company/members` and returns `user_id`/`full_name`. The frontend caller was corrected to the existing runtime contract; no backend alias or behavior change was introduced.

Three compatibility loops use variable paths. Their current primary operations are documented:

- `POST /auth/signout`
- `GET /logistics/shipments`
- `GET /logistics/shipments/{id}`

Their secondary `/auth/sign-out`, `/shipments` and `/shipments/{id}` values are legacy 404 fallbacks with no mounted backend route. They are intentionally recorded here rather than falsely added to OpenAPI.

## Automated gates

`npm run openapi:check` now:

1. validates the full document with Swagger Parser;
2. proves every mounted Express operation exists in OpenAPI;
3. checks operation ID uniqueness and required path parameters;
4. requires success responses and representative products/members/error contracts.

Backend CI runs this gate after syntax validation. Jest also covers route parity, representative schemas, auth/error declarations, multipart input and binary output.

The frontend `npm run contract:audit` script scans `app`, `components`, `contexts`, `hooks` and `lib` with the TypeScript AST and compares calls to the sibling backend OpenAPI document. Set `BACKEND_REPO_PATH` when the repositories are not siblings.

## Verification evidence

- OpenAPI baseline: 5 paths.
- Runtime route inventory: 165 operations / 129 paths.
- Final OpenAPI: 166 operations / 130 paths including `/health`.
- Frontend AST audit: 374 files, 126 statically resolved operations, 3 reviewed dynamic dispatches, 0 missing operations.
- `npm run openapi:check`: PASS.
- `tests/config/openapi.test.js`: PASS, 4 tests.
- `npm run verify:full`: PASS, 25 suites and 270 tests.
- `npm run lint`: PASS with zero warnings/errors.
- `npm run build:release`: PASS.
- No database, production data, RAG service or paid external API was accessed.

## Remaining boundaries

- The three legacy frontend fallbacks should be removed later only after their compatibility requirement is explicitly retired.
- Domain-specific schemas beyond products/company-members should be tightened feature-by-feature during WP-C2 instead of guessing response fields in WP-C1.
- OpenAPI describes current behavior; it does not approve breaking endpoint redesign.

## Rollback

Revert the WP-C1 backend commit and the paired frontend caller commit. This restores the five-path Swagger document and duplicated server route mounting. No database, migration or production-data rollback is required.
