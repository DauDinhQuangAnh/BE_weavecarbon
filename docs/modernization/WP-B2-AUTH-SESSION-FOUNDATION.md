# WP-B2 - Auth Token and Refresh-Session Foundation

Increment status: PASS

Auth domain status: IN PROGRESS

WP-B2 overall status: IN PROGRESS

## Scope

This increment establishes the Auth module boundary for cryptographic token operations and persisted refresh sessions. Auth was split after preflight showed that the legacy route and service also contain signup, email verification, Google OAuth, company onboarding and demo seeding. Those remaining capabilities require separate proof-backed increments.

No route, payload, token claim, cookie, database schema or deployment-topology change is included.

## Resulting boundary

```text
legacy auth callers (compatibility)
              |
              v
        auth module index
          /          \
     tokens     refreshSessionService
                       |
                       v
              refreshTokenRepository
                       |
                       v
               shared database adapter
```

- `tokens.js` owns password hashing and JWT generation/verification.
- `refreshSessionService.js` owns refresh-session use cases and rotation rules.
- `refreshTokenRepository.js` owns schema readiness, SQL and transaction lifecycle.
- The old `services/authService/tokens` path is retained as a one-line compatibility export.
- The legacy AuthService API delegates refresh-session operations to the module, so middleware and routes do not require a coordinated rewrite.
- The Auth manifest is `in-progress`; it must not be marked migrated until the remaining Auth capabilities are feature-local.

## Preserved security behavior

- Refresh tokens are represented in PostgreSQL only by SHA-256 hashes.
- Access, refresh, company-invite and email-verification token claims and secrets are unchanged.
- Refresh rotation locks the candidate session with `FOR UPDATE`.
- The configurable rotation grace period remains unchanged.
- Active sessions are revoked before replacement tokens are persisted.
- Missing/expired sessions explicitly roll back and return `null`.
- Failed rotations roll back and release their database connection.
- IP address and user-agent metadata remain attached to stored sessions.

## Verification evidence

- Targeted Auth verification: 6 suites / 55 tests passed.
- Full backend verification: 33 suites / 302 tests passed.
- Syntax check: 133 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime operations.
- OpenAPI artifact SHA-256 remained `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Remaining Auth work

The next Auth increments must extract user/company persistence and signup, followed by verification/invite flows, Google OAuth and demo provisioning. The large legacy route should only become a thin modular route after those handlers have feature-local services and repository coverage.

## Rollback

Rollback is a normal revert of this increment's commit. The existing `refresh_tokens` schema and stored sessions remain compatible because neither their structure nor hashing format changed.
