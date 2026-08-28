# WP-B2 - Auth Signup and Account Persistence

Increment status: PASS

Auth domain status: IN PROGRESS

WP-B2 overall status: IN PROGRESS

## Scope

This increment extracts email signup, invited-user creation and their shared user/company persistence from the legacy Auth route and AuthService. It builds on the token and refresh-session foundation without changing public authentication contracts.

No API path, request/response payload, validation rule, database schema or token format is changed.

## Resulting boundary

```text
POST /auth/signup
        |
        v
signupService
        |
        v
accountProvisioningService ---> shared token/subscription/company-market ports
        |
        v
userRepository -------------> shared database adapter
```

- `signupService.js` owns duplicate-email, pending-invite and re-registration rules.
- `accountProvisioningService.js` owns B2B/B2C account provisioning and result mapping.
- `userRepository.js` owns user, profile, role, company, membership, trial and rewards SQL used by signup.
- The signup route now maps HTTP input/output and triggers email/analytics side effects after provisioning.
- Existing AuthService methods delegate to the modular implementation, preserving consumers in sign-in, OAuth, middleware and Organizations.

## Preserved behavior

- Verified emails are rejected with `409 EMAIL_EXISTS`.
- Pending company invites are protected with `409 INVITED_ACCOUNT_PENDING_ACTIVATION`.
- Unverified accounts without a pending invite are deleted before re-registration.
- Password hashing and invited-account normalization are unchanged.
- B2B signup creates the company, assigns the profile, creates an active admin membership and initializes a trial in one transaction.
- Trial initialization remains best effort and does not fail account creation.
- Trial plans continue to normalize target markets according to existing rules.
- B2C signup creates rewards and does not create a company.
- PostgreSQL role arrays keep the existing string/array normalization behavior.

## Verification evidence

- Targeted Auth verification: 10 suites / 72 tests passed.
- Full backend verification: 37 suites / 319 tests passed.
- Syntax check: 138 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime operations.
- OpenAPI artifact SHA-256 remained `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Remaining Auth work

Auth is not complete. The remaining increments are email verification/company invite activation, Google OAuth, demo provisioning and final route/validator relocation. SQL still present in the legacy AuthService belongs to those explicitly deferred flows.

## Rollback

Rollback is a normal revert of this increment's commit. No database migration or stored-data conversion is required.
