# M4 Backend Operations Evidence

Status: implementation complete; production CI/deploy evidence is recorded by the
GitHub workflows and the frontend platform ledger.

## Durable work

- Migration `016_operational_jobs.sql` owns queue state, unique idempotency keys,
  attempts, exponential retry scheduling, worker locks, retained dead jobs and
  result payloads.
- `FOR UPDATE SKIP LOCKED` claiming supports multiple workers without duplicate
  execution. Startup recovers stale `running` jobs and backfills unfinished report
  and evidence records.
- PDF/CSV report generation, stored-evidence extraction/RAG ingestion, and product
  imports of 25 or more rows use the durable queue. Smaller imports stay inline to
  avoid queue overhead.
- Batch and market score recalculation remain transaction-local because inspection
  confirmed they are bounded aggregate `UPDATE` statements whose atomicity is part
  of the parent mutation.
- `/api/operations/jobs/:id` is tenant-scoped and lets clients poll async results.

## Runtime operations

- `/health` is process liveness; `/ready` gates database and worker readiness;
  `/metrics` exposes low-cardinality Prometheus counters.
- Incoming safe `X-Correlation-ID` values are preserved, generated IDs are returned,
  and the value is propagated to RAG. Access logs are structured and query strings
  are excluded.
- Logger tests prove credential redaction. Cache instances declare owner, version,
  TTL and tenant-aware invalidation while reporting hit/miss/expiry counters.
- SIGTERM stops accepting work, drains active jobs within the configured grace
  period, closes HTTP and database resources, and reports whether drain completed.

## Verification

- `npm run verify`
- `npm test -- --runInBand`
- `npm run test:m4-operations` against disposable PostgreSQL in CI
- Backend image policy: non-root runtime, readiness healthcheck, Critical CVE gate,
  350 MiB maximum, OCI SBOM and provenance attestations.
