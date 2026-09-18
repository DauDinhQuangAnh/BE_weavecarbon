# G2-13 Enterprise Security and Production Acceptance

Baseline date: 2026-09-18  
Vision source: `WeaveCarbon Mới cập nhật 12.09.docx`

## Truth boundary

G2-13 is an implemented software baseline, not proof that production or an external identity provider has accepted the release. The repository now enforces MFA and governed security/acceptance ledgers, but production remains unaccepted until the exact immutable images are deployed and the live evidence gates pass.

An OIDC record marked `active` means its discovery, JWKS, ID-token validation and login-round-trip checks were attested with current locked evidence. It does not mean WeaveCarbon contains a generic runtime OIDC handshake for every identity provider. External IdP interoperability, claim mapping, logout and recovery must be validated for each enterprise tenant before SSO is sold as live.

## Implemented controls

- RFC 6238 TOTP MFA with AES-256-GCM seed encryption, ten one-time scrypt-hashed recovery codes and append-only factor revisions.
- Password re-verification for enrollment/rotation/disable, preservation of the old active factor during a pending rotation, and transactional recovery-code consumption.
- MFA-bound access and refresh tokens; pre-MFA sessions are rejected after MFA activation, and Google OAuth cannot bypass an enabled factor.
- Production startup requires a valid 32-byte `MFA_ENCRYPTION_KEY`; the example configuration contains only a placeholder.
- Tenant-bound, evidence-backed immutable revisions for enterprise policy and OIDC configuration.
- Append-only key lifecycle events with external secret-manager references; raw key material and client secrets are rejected from the model.
- Governed incident lifecycle events and an explicit transition sequence.
- Immutable production acceptance records bound to commit SHAs, image digests, rollback digest, migration, CI URL, backup/restore hash, smoke gates, scan summary and locked evidence.
- `/version` publishes the running backend commit, capability version and highest applied migration for release verification.
- The backend deploy workflow bakes the exact commit into the image and verifies `/health`, `/ready` and `/version`; mismatched commit, migration or capability version fails the deployment gate and uploads smoke evidence.
- Admin UI for MFA, policies, OIDC validation records, key lifecycle, incidents and production acceptance. Demo mode is read-only.

## Acceptance gates

An `accepted` production record is rejected unless all of the following are true:

1. The database reports `051_g2_enterprise_security_acceptance.sql` as the highest migration and matches the declared migration.
2. Health, readiness, capability, authentication, tenant-isolation, migration and rollback smoke gates are all true.
3. Unresolved critical and high findings are both zero.
4. An approved enterprise security policy exists.
5. Every active company administrator has MFA when the policy requires it.
6. A current evidence-backed OIDC connection exists when the policy requires SSO.
7. No active key is past its rotation deadline and no incident remains open.
8. Commit hashes, image/rollback digests, backup/restore hash and locked release evidence pass structural and tenant checks.

## Verification evidence

- Backend unit suite covers RFC TOTP vectors, encryption-key validation, MFA rotation state, session enforcement, Google bypass prevention and acceptance-gate rejection.
- The isolated PostgreSQL pilot `npm run test:enterprise-security-pilot` proves migration currency, every G2-13 ledger, tenant-bound foreign keys and immutability, then rolls back all synthetic data.
- `npm run verify` checks syntax, OpenAPI, module boundaries and lint.
- Frontend typecheck, contract generation, network-boundary audit and source-contract tests cover the MFA and enterprise workspace.

Local checkpoint on 2026-09-18: backend verification passed with 254 OpenAPI paths, 348 operations and 345 runtime-operation matches; all 172 Jest suites and 931 tests passed; the isolated migration-051 pilot passed. Frontend full verification passed with all 70 Vitest files and 262 tests, and the production build completed all 76 routes. Frontend lint reported the same 20 non-blocking pre-existing warnings and no errors.

## External proof still required

- Configure and custody a production `MFA_ENCRYPTION_KEY`, enroll named administrators and securely distribute recovery procedures.
- Complete a real external-IdP interoperability test, including issuer/discovery pinning, JWKS rotation, signature/claims/nonce validation, account linking, logout and break-glass recovery.
- Run an independent penetration test and remediate findings.
- Execute a timed incident-response exercise and collect notification/escalation evidence.
- Deploy reviewed backend and frontend immutable images, verify exact commits and migration 051 on the host, inspect logs/restarts, prove rollback and backup restore, and create a locked production acceptance record.
- Merge the matching frontend release first so `main` contains the `/ready` and `/version` Caddy routes. The backend deploy now fails before changing the backend image if those routes or a valid production `MFA_ENCRYPTION_KEY` are absent.
- Complete the real-facility end-to-end data pilot required by the broader 12 September vision.

Until those gates pass, enterprise security and production acceptance remain `partial`; no production-complete, certified, penetration-tested or SSO-live claim is permitted.
