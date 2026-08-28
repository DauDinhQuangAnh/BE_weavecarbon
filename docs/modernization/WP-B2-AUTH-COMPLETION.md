# WP-B2 - Auth Module Completion

Increment status: PASS

Auth domain status: COMPLETE

WP-B2 overall status: IN PROGRESS

## Scope

This final Auth increment extracts email/password session orchestration, refresh/access
session bootstrap, signout, check-company persistence, HTTP helpers, Auth validators and
signup side effects into the Auth module. It completes the incremental Auth migration
started by the session, signup, verification, Google OAuth and demo increments.

No API path, request/response payload, validation rule, status/error code, cookie policy,
database schema or token format is changed.

## Final boundary

```text
Express Auth route
       |
       +--> signupService
       +--> authSessionService
       +--> verificationService
       +--> googleOAuthFlowService
       +--> demoAccountService
       |
       +--> Auth HTTP + validation adapters
                    |
                    v
       Auth repositories and shared infrastructure ports
```

- `authSessionService.js` owns email/password sign-in, refresh rotation, cookie-session
  bootstrap, legacy bearer bootstrap compatibility, signout and check-company use cases.
- `signupService.js` now owns verification-email dispatch, signup analytics and public
  signup response mapping in addition to account registration rules.
- `http.js` is the Auth module's HTTP mapping/support surface. Its implementation is
  mechanically identical to the previous route helper apart from modular dependencies.
- `validation.js` is the Auth module's validator surface. All validation chains are
  mechanically identical to the previous validator implementation.
- `userRepository.js` owns the remaining check-company profile/role query.
- `accountProvisioningService.js` owns check-company resolution and exposes trial
  initialization to the compatibility facade.
- `src/routes/auth/helpers.js` and `src/validators/authValidators.js` remain one-line
  compatibility re-exports for existing consumers.
- `src/services/authService.js` remains a compatibility facade with no Auth SQL or
  business orchestration.
- The Auth module manifest is now `active`.

## Preserved behavior

- Invalid email and invalid password continue to return the same
  `401 INVALID_CREDENTIALS` response.
- Unverified non-demo users continue to receive `403 EMAIL_NOT_VERIFIED`.
- Login timestamps, primary membership selection and login analytics are unchanged.
- Refresh rotation, remember-me behavior, request metadata and revoked-session handling
  are unchanged.
- Session bootstrap still prefers a refresh token and falls back to a bearer access
  token; legacy access tokens without a `type` claim remain accepted until expiry.
- Signout still supports current-session and all-device revocation and always clears the
  refresh cookie.
- Signup verification email remains non-blocking and analytics failure remains non-fatal.
- Check-company retains the minimal `{ has_company: false }` response when no profile
  exists and membership fallback when the profile has no company ID.
- Verification/invite HTML rendering and Google OAuth redirects remain presentation
  responsibilities of the Express adapter.

## Verification evidence

- Targeted final Auth verification: 11 suites / 75 tests passed.
- Full backend verification: 51 suites / 399 tests passed.
- Syntax check: 155 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- HTTP helper and validator implementation parity checks passed.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact SHA-256 remained
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Compatibility surface

Compatibility exports are intentionally retained because middleware and other backend
domains still consume the legacy AuthService API. They delegate to Auth module services
and can be removed only after those callers migrate in their own WP-B2 domain increments.
Their presence does not make Auth the owner of those future migrations.

## Remaining WP-B2 work

Auth is complete, but WP-B2 is not. Remaining backend domains must be migrated one at a
time using the same module boundary and compatibility pattern.

## Rollback

Rollback is a normal revert of this increment's commit. No database migration or
stored-data conversion is required.
