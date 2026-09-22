# WeaveCarbon — Backend API

The API behind WeaveCarbon, built with **Node.js, Express and PostgreSQL**. It is
the system of record: it persists product carbon assessments, serves the
dashboard/compliance data the web client (`Weavecarbon`) renders, handles VNPAY
billing, and brokers requests to the Python RAG service (`rag/`).

## Role in the platform

The backend is authoritative for persisted carbon calculations, evidence and
official reports. The frontend engine supports previews, but its results do not
replace backend-owned, versioned calculation snapshots:

- **Persistence & aggregation** — products, assessment snapshots, shipments,
  electricity/fuel invoices (Scope 1/2), evidence documents, audit trail.
- **Auditability** — product and evidence changes are recorded so a carbon
  result can be traced back to its source data (product-carbon pre-audit).
- **Export & compliance** — shipment-scoped document preparation, applicability
  checks and evidence-bound PDF/XLSX reports. A generated file is not itself a
  customs filing, certification or legal approval.
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

- `backend-ci.yml` — syntax, lint, OpenAPI, unit, build, integration and security
  checks on push/PR. Its dependency audit is advisory; the other gates remain
  blocking.
- `backend-deploy.yml` — deploys the backend after a successful `main` CI run.
- `dependency-audit.yml` — weekly dependency check and tracking issue for new
  high/critical advisories; it does not block unrelated pushes.
- Deploy secrets: `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
  (missing required secrets fail the deploy job).

## Working documentation

- `docs/INDUSTRIAL_PLATFORM_MASTER_TRACKER.md` — G2 capability status and
  remaining real-world acceptance boundaries.
- `docs/EXPORT_REPORT_MASTER_TRACKER.md` — detailed R01–R20 report matrix,
  source register and dated implementation evidence.
- `docs/WEAVECARBON_12_09_IMPLEMENTATION_AUDIT.md` — requirement-to-implementation
  assessment. The pilot runbooks in `docs/` retain acceptance procedures and
  evidence requirements; they are not disposable build notes.
- `docs/MODERNIZATION.md` — historical modernization closeout, not a current
  product-release certificate.

## Docker

The backend builds with the included `Dockerfile`. Production composition is
defined in the frontend repository's `docker-compose.vps.yml`; deployment and
rollback procedures are in `deploy/CI_CD.md` and `docs/operations/RUNBOOKS.md`.
