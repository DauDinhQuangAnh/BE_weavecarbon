# WP-0A Backend Baseline

- Date: 2026-08-27
- Repository: `D:\hoctap\WCB\BE_weavecarbon`
- Remote: `https://github.com/DauDinhQuangAnh/BE_weavecarbon`
- Baseline commit: `b29e024` (`ci(deploy): ssh-keyscan honors DEPLOY_PORT; skip gracefully if VPS unreachable`)
- Working branch: `codex/wp-0a-baseline`

WP-0A result: **PASS** — inventory is complete; pre-existing warnings and cross-repository blockers are recorded below.

## Scope and invariants

This work package changed documentation only. It did not refactor runtime code, change public route/payload behavior, run migrations, connect to production data, or deploy anything.

## Runtime and repository inventory

- Node.js CommonJS service using Express 4 and PostgreSQL through `pg`.
- Package manager: npm with committed `package-lock.json`.
- Local diagnostic runtime: Node `v24.11.1`, npm `11.6.4`, loaded from `D:\hoctap\node`.
- CI and Docker target Node 22, so local and CI major versions currently differ.
- 168 tracked files and 22 tracked Jest test files at the baseline commit.
- `src/server.js` registers middleware and 24 route prefixes/modules. Static inspection found 165 Express route endpoints.
- Main layers today:
  - `src/routes/` — routing and request handling;
  - `src/services/` — business logic and database orchestration;
  - `src/validators/` — input validation;
  - `src/middleware/` — authentication, authorization, rate limiting and errors;
  - `src/config/` — database, URLs, runtime settings, Swagger and schema capability bootstrap.
- The service is the system of record for companies, products, assessment snapshots, invoices, shipments, evidence, reports, audit data and subscriptions.
- Carbon methodology is not authoritative here yet. `/api/carbon-calculations` currently persists/exposes calculation records while the frontend owns the calculation engine.

## Public API surface and compatibility boundaries

Mounted route prefixes:

- `/api/auth`, `/api/account`, `/api/company/members`, `/api/subscription`
- `/api/dashboard`, `/api/products`, `/api/product-batches`, `/api/logistics`
- `/api/carbon-calculations`, `/api/electricity-invoices`, `/api/fuel-invoices`
- `/api/reports`, `/api/export`, `/api/export/markets`, `/api/evidence`, `/api/passport`
- `/api/suppliers`, `/api/data-gaps`, `/api/audit-trail`
- `/api/chat`, `/api/ai-config`, `/api/contact`, `/api/b2c`, `/api/b2c-admin`
- `/health`; Swagger UI under `/api-docs` outside production or when explicitly enabled.

Current response envelopes, auth cookies/tokens, status/error codes, pagination parameters, report download behavior and product/assessment payload shapes are compatibility boundaries for later work packages.

### OpenAPI state

- `src/config/swagger.js` loads route JSDoc annotations successfully as OpenAPI `3.0.3`.
- The generated specification contains only five paths, all under auth: signup, signin, signout, refresh and session.
- This is substantially smaller than the 165 statically detected live endpoints and is the primary input to `WP-C1`.

## Database and migration mechanism

- PostgreSQL is accessed through a shared `pg.Pool` with `max: 20`, 30-second idle timeout and 2-second connection timeout.
- `npm run migrate` executes `scripts/migrate.js`.
- Migrations are ordered SQL files under `migrations/`; 12 migrations exist (`001` through `012`).
- Applied files and SHA-256 checksums are stored in `public.schema_migrations`; modifying an already-applied migration produces a checksum failure.
- Normal migrations run inside a transaction. Files marked `-- no-transaction` or containing `CREATE INDEX CONCURRENTLY` run statement-by-statement.
- No down-migration framework is present; operational practice is forward migration plus application compatibility/backup restore.
- `start:prod` and the Docker command run migrations before starting the server.
- No migration was executed during WP-0A because a disposable local PostgreSQL instance and the `WP-S1` restore gate were not available.

Persistent state includes PostgreSQL data plus files under the configured uploads directory/`be_uploads` volume. Report and evidence storage keys are persisted in PostgreSQL.

## Backend to RAG contract

- `src/services/chatService.js` resolves an allowlisted RAG base URL, applies timeout/error normalization and sends `X-Internal-API-Key` only when `RAG_INTERNAL_API_KEY` is configured.
- Chat/recommendation routes proxy RAG operations under `/api/chat/*`.
- Administration/health/collection/ingest/query operations are proxied under `/api/ai-config/rag/*`.
- Evidence ingestion uses RAG through `/api/evidence/:id/rag-ingest`.
- Compatibility error codes include `RAG_PROXY_BASE_URL_NOT_ALLOWED`, `RAG_BACKEND_UNAVAILABLE`, `RAG_BACKEND_TIMEOUT` and `RAG_BACKEND_ERROR`.
- `RAG_INTERNAL_API_KEY` is used in code but is absent from the backend `.env.example` and the current VPS Compose environment.

## Environment variables

No `.env` values were read or copied. `.env` is ignored and not tracked.

Secrets:

- `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `EMAIL_PASSWORD`, `VNPAY_HASH_SECRET`
- `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`
- `ANALYTICS_HMAC_SECRET`, `GA4_API_SECRET`
- `RAG_INTERNAL_API_KEY`
- deployment SSH/registry credentials held in GitHub secrets

Non-secret/configuration:

- Server/database: `NODE_ENV`, `PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`
- URLs/CORS/auth policy: `FRONTEND_URL`, `FRONTEND_URLS`, `CORS_ORIGIN`, `AUTH_COOKIE_DOMAIN`, `AUTH_PUBLIC_BASE_URL`, `API_BASE_URL`, `BACKEND_URL`
- Runtime limits/logging: `API_RATE_LIMIT_DISABLED`, `API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_WINDOW_MS`, `READ_CACHE_TTL_MS`, `SLOW_REQUEST_MS`, `LOG_LEVEL`, `LOG_ERROR_STACK`, `AI_HTTP_ACCESS_LOGS`, `AI_REQUEST_LOGS`
- RAG routing: `RAG_PROXY_ALLOWED_BASE_URLS`, `RAG_PROXY_INTERNAL_BASE_URL`, `RAG_EVIDENCE_COLLECTION_PREFIX`
- Other service configuration includes JWT expiry, email host/timeouts, VNPAY URLs/mode, Google redirect/client ID, GA4 measurement ID, analytics flush limit, export concurrency and uploads directory.

The example environment file does not currently enumerate every variable referenced by code, especially RAG internal auth and several runtime/logging controls.

## Docker and deployment

- `Dockerfile` installs production dependencies with `npm ci --omit=dev`, copies runtime source/migrations/templates and exposes port 4000.
- The image runs migrations and then starts the server. It does not currently set a non-root runtime user.
- Runtime healthcheck is `GET /health`; that endpoint requires a successful `SELECT 1` against PostgreSQL and returns 503 when the database is unavailable.
- The full topology is owned by the frontend repo's `docker-compose.vps.yml` and deployment scripts.
- Backend CI builds a staged `.release/app`; the generated `.release` directory is ignored.

## CI/CD inventory

- `backend-ci.yml`: clean install, syntax, lint, Jest tests, release build and migration validation against a PostgreSQL service.
- `dependency-audit.yml`: scheduled dependency audit/tracking.
- `backend-deploy.yml`: builds/pushes a GHCR image and invokes the shared VPS redeploy script after successful CI.
- Deployment uses SHA image tags but still updates a server checkout before invoking orchestration, so immutable promotion is incomplete.

## Verification evidence

| Check | Result | Evidence |
|---|---|---|
| Git pre-check | PASS | `main` was clean and tracked `origin/main`; branch `codex/wp-0a-baseline` created. |
| `npm run check:syntax` | PASS | 106 JavaScript files checked. |
| `npm run lint` | PASS with pre-existing warnings | Exit 0; 38 unused-variable warnings, 0 errors. |
| `npm test -- --runInBand` | PASS | 22 suites and 259 tests passed. Error-level log messages are intentional assertions of failure paths inside passing tests. |
| `npm run build:release` | PASS | Runtime release staged under ignored `.release/app`. |
| OpenAPI load | PASS with coverage gap | OpenAPI 3.0.3 loaded; only 5 paths are documented. |
| Server startup/health | NOT RUN | Startup bootstraps schema capabilities and the report job queue against PostgreSQL. No disposable database was available; using configured `.env` could contact unintended data. |
| Migration execution | NOT RUN | Intentionally deferred until a disposable database and `WP-S1` safety gate are available. |
| Docker build/image inspection | UNAVAILABLE | Docker CLI/daemon is not available in the current execution environment. |

## Pre-existing findings and risks

1. **P0 — RAG exposure/auth mismatch:** backend supports an internal key, but current deployment does not inject one while Caddy exposes RAG publicly. Run `WP-S2` immediately.
2. **P0 — carbon authority:** backend persists carbon results but does not yet own the authoritative deterministic engine.
3. **OpenAPI coverage gap:** 5 documented paths versus 165 detected live route endpoints. Generated frontend contracts are not currently viable without `WP-C1`.
4. **Migration safety:** production/container startup automatically migrates. Backups and restore must pass `WP-S1` before snapshot/tenancy/index migrations.
5. **Lint warnings:** 38 warnings are accepted by the current lint configuration and are baseline, not newly introduced failures.
6. **Runtime user:** backend container runs as root.
7. **Environment documentation drift:** several variables used by code are missing from `.env.example`.

## Likely performance-sensitive paths (not yet measured)

- Dashboard aggregation/cache, product list/detail and assessment persistence.
- Report generation/export jobs and uploaded evidence processing.
- Export-market document operations and bulk imports.
- RAG proxy query/ingest/recommendation calls.
- PostgreSQL joins for products, shipments, evidence and audit data.

Measurements, query plans and performance budgets belong to later work packages; no improvement is claimed here.

## Rollback

Delete this documentation file and revert the WP-0A documentation commit. No runtime rollback, migration rollback or data restore is required.
