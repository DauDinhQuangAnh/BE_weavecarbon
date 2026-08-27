# WP-0B Backend Performance and Delivery Baseline

- Measurement date: 2026-08-27
- Commit measured: `ec034d1c3b21d97f589c9fe2d3064de4beb8c8ae`
- Result: **PARTIAL** — release staging and CI are measured; valid startup and
  endpoint latency require PostgreSQL or staging access that is not available.
- Product behavior changes: none

## Measurement environment

- Windows 11 Pro 64-bit, Intel Core i5-6500 (4 cores / 4 threads), 15.43 GiB RAM
- Node `24.11.1`, npm `11.6.4`
- Repository: `D:\hoctap\WCB\BE_weavecarbon`
- No PostgreSQL Windows service and no listener on `127.0.0.1:5432`
- Docker is not installed; the VPS was unreachable from the measured workflow

## Release artifact baseline

Command: `D:\hoctap\node\npm.cmd run build:release`.

| Measurement | Baseline |
| --- | ---: |
| Wall time | 1.203 s |
| Staged files in `.release/app` | 124 |
| Staged bytes | 1,690,639 bytes (1.61 MiB) |

This staged artifact excludes installed production dependencies and the Node
base image. It must not be presented as final container size.

## Startup and endpoint availability

The real application waits for schema capability bootstrap and report-job queue
initialization before listening. A controlled attempt against the absent local
PostgreSQL endpoint exited with `ECONNREFUSED` after 2.357 s and never opened the
HTTP port. Therefore:

- successful backend startup time: **UNAVAILABLE**
- `/health` latency with its real `SELECT 1`: **UNAVAILABLE**
- representative authenticated endpoint latency: **UNAVAILABLE**

Mocking the pool would measure test-double/Express overhead rather than the real
bootstrap and database path, so WP-0B intentionally does not invent that number.

## CI and deployment baseline

GitHub Actions run for the measured commit:

- Backend CI run `33036471274`: success in 30 s overall.
- Parallel jobs: integration 27 s, lint/syntax 15 s, audit 14 s, unit tests 14 s
  and release build 12 s.
- Backend deploy run `33036497239`: success in 47 s; image build/push passed,
  SSH configuration completed, but actual VPS deployment was skipped because the
  host was unreachable.

Production topology at this commit: backend listens on Compose port 4000 with no
host publication and is reachable publicly only through Caddy `/api/*` and
`/health`. It connects to PostgreSQL on the private Compose network and calls RAG
at `http://rag:8000` with internal authentication.

## Unavailable measurements and repeat plan

- Docker image size/history: Docker is absent, and anonymous GHCR manifest access
  returned HTTP 401.
- Repeat startup and latency on an isolated PostgreSQL restored from safe
  development/staging data. Record at least 3 cold starts and 50 sequential
  `/health` plus representative authenticated requests, including DB timing.
- Do not target production by default and do not use customer payloads.

No optimization claim or budget is established here. WP-0B remains PARTIAL until
the database-backed runtime and image measurements are attached. Rollback is
reverting this documentation-only commit.
