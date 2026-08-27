# WP-S2 Backend-to-RAG Authentication

- Date: 2026-08-27
- Status: verified

The backend now fails closed when internal RAG authentication is required but
`RAG_INTERNAL_API_KEY` is missing. Every outbound RAG call receives the
server-owned `X-Internal-API-Key`; a caller-provided value cannot replace it.
Missing configuration returns stable code `RAG_INTERNAL_AUTH_NOT_CONFIGURED`
with HTTP 503. An explicit `RAG_REQUIRE_INTERNAL_API_KEY=false` opt-out remains
available only for isolated local development.

Verification:

- ESLint: PASS with 38 pre-existing warnings and no new warning.
- Jest: PASS, 263/263 tests, including four new internal-auth tests.
- `node --check`: PASS for 112 JavaScript files.
- Release build: PASS.

Rollback should preserve the private Caddy/Compose boundary. Revert only the
backend WP-S2 application commit if necessary, keep the shared key configured,
and coordinate the matching RAG application rollback in the same maintenance
window. Do not restore a public RAG route as part of application rollback.
