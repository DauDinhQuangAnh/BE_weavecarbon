# WP-B2 - Auth Google OAuth

Increment status: PASS

Auth domain status: IN PROGRESS

WP-B2 overall status: IN PROGRESS

## Scope

This increment extracts the Google OAuth protocol client, Google account persistence,
callback orchestration and shared post-authentication company context from the legacy
Auth route and AuthService.

No API path, query parameter, redirect payload, cookie policy, database schema or token
format is changed.

## Resulting boundary

```text
GET /auth/google -----------------> googleOAuthFlowService
                                            |
GET /auth/google/callback ------------------+
                                            |
                    +-----------------------+-----------------------+
                    |                       |                       |
                    v                       v                       v
          googleOAuthClient      googleAccountService    sessionContextService
          Google protocol/state         |                       |
                                        v                       v
                                 userRepository          Auth module repositories
                                        |
                                        v
                               shared database adapter
```

- `googleOAuthClient.js` owns signed OAuth state, Google authorization URL generation,
  token exchange and user-info retrieval.
- `googleAccountService.js` owns existing/new Google account rules and B2B/B2C
  provisioning decisions.
- `googleOAuthFlowService.js` owns callback orchestration, analytics, verification
  email, token issuance, refresh-session persistence and authorization-code replay
  caching.
- `sessionContextService.js` owns primary membership selection and the legacy
  profile-company fallback used to construct token context.
- `userRepository.js` owns the Google user/profile/company SQL introduced into the
  modular boundary.
- The legacy Google service entrypoint and AuthService methods delegate to the new
  module so existing consumers remain compatible.

## Preserved behavior

- OAuth state remains HMAC signed, includes a nonce and expires after 10 minutes.
- `intent`, `flow`, `mode`, role, frontend-origin and remember-me query aliases remain
  accepted and documented.
- Provider failures retain the stable `GOOGLE_TOKEN_EXCHANGE_FAILED` and
  `GOOGLE_USERINFO_FAILED` error codes.
- Processed authorization codes retain the five-minute replay redirect cache.
- Existing users keep their account and receive updated avatar/verification state.
- New B2C users receive rewards; new B2B OAuth signups continue to company onboarding
  instead of receiving an implicit company.
- Email verification blocking and verification-email side effects remain unchanged.
- Membership login timestamps, login/signup analytics and next-step selection remain
  unchanged.
- The httpOnly refresh cookie is issued only after refresh-session persistence
  succeeds; access-token login remains available if that persistence fails.
- Frontend callback errors and metadata keep the existing fragment-based redirect
  contract and approved-origin fallback.

## Verification evidence

- Targeted Google OAuth verification: 6 suites / 32 tests passed.
- Full backend verification: 45 suites / 364 tests passed.
- Syntax check: 144 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact SHA-256 remained
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Remaining Auth work

Auth is not complete. The remaining increments are demo-account provisioning and final
Auth route/helper/validator relocation. SQL that remains in the legacy AuthService and
Auth route belongs to those explicitly deferred flows.

## Rollback

Rollback is a normal revert of this increment's commit. No database migration or
stored-data conversion is required.
