# WP-B2 - Auth Demo Provisioning

Increment status: PASS

Auth domain status: IN PROGRESS

WP-B2 overall status: IN PROGRESS

## Scope

This increment extracts demo-account persistence, B2C reward sample generation, B2B
sample-data orchestration and demo-session response construction from the legacy Auth
route and AuthService.

No API path, request/response payload, validation rule, database schema, demo lifetime
or token format is changed.

## Resulting boundary

```text
POST /auth/demo
       |
       v
demoAccountService -----------------> token + analytics ports
       |
       +--------------------+--------------------+
       |                    |                    |
       v                    v                    v
demoRepository       demoB2CSeeder       shared B2B seeder port
       |                    |
       +--------------------+
       |
       v
shared database adapter
```

- `demoAccountService.js` owns B2B/B2C provisioning decisions, demo credentials,
  expiration, token issuance, analytics identity and public response mapping.
- `demoRepository.js` owns demo user/profile/company/membership/subscription, donation
  and rewards SQL plus transaction/savepoint handling.
- `demoB2CSeeder.js` owns deterministic sample donation/reward calculations while
  delegating persistence to the repository.
- Existing B2B and B2C seed implementations are accessed through shared module ports,
  preserving the approved Auth dependency boundary.
- The demo route now performs only HTTP validation, use-case invocation and response
  delivery.
- Legacy AuthService methods delegate to the modular service for compatibility.

## Preserved behavior

- `POST /auth/demo` still accepts `role` and optional `demo_scenario`; omitted scenario
  still defaults to `sample_data`.
- `demo_scenario` remains compatibility metadata and does not select different seed
  behavior, matching the previous implementation.
- Demo emails retain the `demo_<8 characters>@weavecarbon.demo` format and the returned
  password remains `Demo@123456`.
- Demo users remain verified, flagged as demo users and expire after 24 hours.
- B2B demo accounts create an admin membership and a Standard company with a 20-SKU
  allowance.
- Standard-cycle initialization remains best effort.
- Optional B2B sample-data failure remains isolated behind the existing PostgreSQL
  savepoint and does not discard the base demo account.
- B2C demo accounts retain material defaults, two representative donations, reward
  transactions, aggregate points/weight/CO2 savings and fallback rewards when material
  data is insufficient.
- Demo access/refresh tokens, analytics keys, response fields and limitation values are
  unchanged.

## Verification evidence

- Targeted demo Auth verification: 5 suites / 19 tests passed.
- Full backend verification: 49 suites / 380 tests passed.
- Syntax check: 149 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact SHA-256 remained
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.

## Remaining Auth work

Auth is not complete. One Auth increment remains: relocate the remaining route helpers,
validators and residual persistence/use-case logic, then prove that the compatibility
surface can be reduced safely.

## Rollback

Rollback is a normal revert of this increment's commit. No database migration or
stored-data conversion is required. Demo accounts created before rollback retain the
same schema and expiry behavior.
