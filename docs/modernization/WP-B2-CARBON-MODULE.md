# WP-B2 - Carbon Persistence Module Migration

Increment status: PASS

Carbon module status: MIGRATED

WP-B2 overall status: IN PROGRESS

## Scope

This increment migrates the existing Carbon persistence APIs into the `carbon` feature
module:

- `/api/carbon-calculations`
- `/api/electricity-invoices`
- `/api/fuel-invoices`

The scope is deliberately limited to the backend behavior that already exists: storing
and retrieving calculation records and utility/fuel invoices. It does not move the
frontend calculation engine into the backend or claim new methodology authority.

No route path, request/response payload, validation rule, error/status code, database
schema, default emission factor or deployment topology is changed.

## Resulting boundary

```text
Three Carbon HTTP routers
            |
            v
       CarbonService
            |
            v
      CarbonRepository ----> shared database port
```

- The three route files own authentication/role middleware, pagination parsing and
  response/error mapping.
- `service.js` owns calculation response mapping, camel/snake input compatibility,
  required-field checks, electricity defaults and fuel CO2e/default-factor behavior.
- `repository.js` owns all SQL and guarantees company scoping for list, update and
  delete operations.
- Repository and service factories provide isolated test seams while singleton exports
  preserve runtime behavior.
- `index.js` is the module's only public surface and lazily exposes all routers,
  repositories and services.
- The previous three route paths remain one-line compatibility exports, so startup
  wiring and consumers are unchanged.

## Preserved behavior

- All ten operations remain mounted: calculation list/create plus electricity and fuel
  list/create/update/delete.
- Pagination defaults and the 500-row upper limit are unchanged.
- Calculation filters, row ordering and camelCase response mapping are unchanged.
- Carbon calculation POST continues to accept both camelCase and snake_case fields.
- Electricity defaults remain `Main Facility`, factor `0.4290`, the existing Vietnam
  factor source and `uploaded` status.
- Fuel factors remain unchanged, including zero-rated biomass and the `2.5` fallback.
- Explicit fuel factor and Scope 1 CO2e values still override calculated defaults.
- Update/delete operations remain company-scoped and keep their existing 404 messages.
- Missing company and required-field responses retain their existing codes/messages.

## Verification evidence

- Carbon verification: 3 suites / 16 tests passed with `--detectOpenHandles`.
- Full backend verification: 58 suites / 428 tests passed.
- Syntax check: 179 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- Lint passed with no warnings or errors.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact remained current with SHA-256
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.
- Tests cover all ten route operations, company-scoped SQL, pagination/count queries,
  input-style compatibility, validation, emission defaults and explicit overrides.

## Remaining WP-B2 work

Carbon is migrated, but WP-B2 is not complete. Evidence and reports remain planned and
must be migrated in bounded increments with the same contract and regression gates.

## Rollback

Rollback is a normal revert of this increment. No database migration or stored-data
conversion is required.
