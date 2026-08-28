# WP-C2 — Versioned OpenAPI Artifact

Status: PASS

## Outcome

The runtime-derived OpenAPI contract now has a deterministic, versioned JSON artifact at `openapi/openapi.json`. The artifact is the backend source consumed by frontend transport type generation.

## Commands

- `npm run openapi:export` regenerates the artifact from `src/config/swagger.js`.
- `npm run openapi:stale` fails when the committed artifact does not exactly match the runtime-derived contract.
- `npm run verify` includes the staleness check.

Backend CI runs both semantic OpenAPI validation and artifact staleness validation. Export-only JWT values are deterministic placeholders scoped to the generation process; no environment secrets are written to the artifact.

## Verification evidence

- Artifact: 254,110 bytes; 130 paths and 166 documented operations.
- Runtime parity: 165 mounted operations matched; the additional operation is `/health`.
- `npm run verify:full`: 25 suites and 270 tests passed; syntax, OpenAPI, staleness, and lint checks passed.
- `npm run build:release`: passed.

## Rollback

Revert the WP-C2 backend commit. This removes the exported artifact and staleness step without changing mounted routes or runtime request handling.
