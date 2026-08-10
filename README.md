# WeaveCarbon — Backend API

The API behind WeaveCarbon, built with **Node.js, Express and PostgreSQL**. It is
the system of record: it persists product carbon assessments, serves the
dashboard/compliance data the web client (`Weavecarbon`) renders, handles VNPAY
billing, and brokers requests to the Python RAG service (`rag/`).

## Role in the platform

The carbon *methodology* lives in the frontend engine; this service is the
persistence and orchestration layer:

- **Persistence & aggregation** — products, assessment snapshots, shipments,
  electricity/fuel invoices (Scope 1/2), evidence documents, audit trail.
- **Auditability** — product and evidence changes are recorded so a carbon
  result can be traced back to its source data (CBAM-style pre-audit).
- **Export & compliance** — market requirements, required-document checklists,
  and report generation (CBAM-style XLSX / PDF).
- **Payments** — VNPAY redirect checkout; the IPN callback is the source of truth.

## Commands

```bash
npm run dev
npm run start
npm run check:syntax
npm run lint
npm test
```

## Structure

- `src/routes/` — HTTP route modules (thin; delegate to services)
- `src/services/` — business logic + database orchestration
- `src/validators/` — request validation
- `src/middleware/` — auth, validation, rate limiting, error handling
- `src/config/` — environment-driven infrastructure config
- `uploads/` — runtime-generated report artifacts (not source)

## API docs

OpenAPI / Swagger UI at `/api-docs` (enabled by default outside
`NODE_ENV=production`; set `ENABLE_API_DOCS=true` to force it). The spec is
generated from `@openapi` JSDoc blocks on route handlers; `src/routes/auth.js`
is the reference for the annotation style.

**Product list `view`** — `GET /api/products?view=summary` returns the core
catalog + carbon totals only (no per-product logistics payload or latest-shipment
join), for consumers like the frontend `ProductContext`. Omit `view` for the full
payload.

## Performance & conventions

- List endpoints paginate and select explicit columns; batch / lateral joins are
  used instead of per-row queries to avoid N+1. The dashboard overview is cached
  server-side.
- Keep request/response shapes stable for FE compatibility; split large services
  into query helpers and mappers rather than changing route contracts.

## CI / CD

- `backend-ci.yml` — syntax + lint on push/PR (npm audit is non-blocking).
- `backend-deploy.yml` — deploys the full VPS stack on pushes to `main`.
- `dependency-audit.yml` — weekly `npm audit`; opens a tracking issue on new
  high/critical advisories (non-blocking, does not fail the run).
- Deploy secrets: `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
  (the deploy job exits cleanly if they are missing).

## Docker

The backend builds with the included `Dockerfile`. For the full FE+BE+DB stack,
use the FE repo's `docker-compose.vps.yml` + `DEPLOY_VPS.md`.
