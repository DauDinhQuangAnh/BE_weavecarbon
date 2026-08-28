# WP-B2 - Auth Verification and Company Invites

Increment status: PASS

Auth domain status: IN PROGRESS

WP-B2 overall status: IN PROGRESS

## Scope

This increment extracts email verification, verification-email resend and company-invite activation from the legacy Auth route and AuthService. HTML link responses and JSON API responses remain presentation concerns in the route; token, account and membership rules are feature-local.

No API path, response payload, token claim, cookie configuration or database schema is changed.

## Resulting boundary

```text
verification/invite HTTP presentation
                 |
                 v
       verificationService
          /             \
 accountProvisioning   shared token/email ports
          |
          v
 verificationRepository ---> shared database adapter
```

- `verificationService.js` owns token validation, account state rules, resend privacy and invite activation orchestration.
- `verificationRepository.js` owns email/member activation and login timestamp SQL.
- Existing AuthService methods delegate to the module for compatibility with remaining Auth consumers.
- Routes retain HTML/JSON rendering, cookie clearing, redirect construction and analytics reporting.

## Preserved behavior

- GET verification normalizes email case and treats an already verified account as success.
- POST verification retains exact token/email comparison and returns `ALREADY_VERIFIED` for an already verified account.
- Missing, invalid and unknown-user verification errors retain their status codes and messages.
- Resend continues to hide whether an unknown email exists.
- Company-invite tokens still require email, company ID and the `company_invite` type.
- Missing and disabled memberships retain `INVITE_NOT_FOUND` and `INVITE_DISABLED` behavior.
- Refresh cookies are cleared after identity confirmation and before membership activation.
- Invite activation retains its established order: verify email, activate membership, update membership login, update user login, reload user.
- HTML success/error pages and JSON redirect payloads remain unchanged.

## Verification evidence

- Targeted Auth verification: 13 suites / 89 tests passed.
- Full backend verification: 40 suites / 336 tests passed.
- Syntax check: 140 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime operations.
- OpenAPI artifact SHA-256 remained `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Remaining Auth work

Auth is not complete. Remaining work is Google OAuth persistence/orchestration, demo provisioning and the final relocation of Auth route/helpers/validators plus remaining session-context persistence.

## Rollback

Rollback is a normal revert of this increment's commit. No database migration or stored-data conversion is required.
