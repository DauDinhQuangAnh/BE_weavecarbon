# WP-B2 - Products Module Migration

Increment status: PASS

Products domain status: MIGRATED

WP-B2 overall status: IN PROGRESS

## Scope

This increment migrates the `/api/products` catalog, assessment-payload and bulk-import
capabilities into the `products` feature module. It includes the Express route, request
validators, product application/persistence service and the existing product helper
services.

Product batches (`/api/product-batches`) are not part of this increment and remain a
separate future domain boundary. No route path, request/response payload, validation
rule, status/error code, database schema or deployment topology is changed.

## Resulting boundary

```text
Products route + validators
           |
           v
ProductsService ----> product mapping, scoring, payload and bulk-import helpers
           |
           +--------> shared database and audit ports
           +--------> transitional compliance and shipment-simulation ports
```

- `routes.js` owns authentication/role middleware, HTTP input extraction, response
  mapping, CSV-template delivery and audit intent.
- `validation.js` keeps every previous Products validation chain beside the feature.
- `service.js` owns catalog queries and product transaction orchestration. A narrow
  dependency-injection factory was added for isolated database/error-path tests while
  preserving the existing singleton export.
- `services/` owns bulk-import execution/validation, carbon confidence scoring,
  assessment payload extraction, response mapping and shipment synchronization.
- `index.js` is the only public module surface and lazily exposes the router, singleton,
  factory, validators and compatibility helpers.
- The previous route, service, validator and helper paths remain one-line compatibility
  exports for existing backend consumers and tests.
- Domestic-compliance and shipment-simulation calls use transitional shared adapters;
  their business logic remains in its existing domain until those domains are migrated.

## Preserved behavior

- All eleven existing Products operations remain mounted with their original paths and
  methods, including validation-only bulk import and CSV template download.
- Company/role access, pagination/filtering/sorting and summary-view behavior are
  unchanged.
- Product create/update/status/delete transactions and their audit events are unchanged.
- Duplicate SKU, missing product, invalid status transition and domestic-compliance
  error contracts are unchanged.
- Product snapshots, carbon confidence results and shipment synchronization preserve the
  existing payload mapping and transaction order.
- Bulk-import save modes, validation and per-row result mapping are unchanged.

## Verification evidence

- Products verification: 9 suites / 69 tests passed.
- Full backend verification: 53 suites / 404 tests passed.
- Syntax check: 168 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- Lint passed with no warnings or errors.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- The generated OpenAPI artifact remained current with SHA-256
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.
- Compatibility tests prove identity for the legacy route, service, validators and all
  seven helper entrypoints, plus the complete eleven-operation route surface.
- Service tests cover connection cleanup on success/error and unchanged bulk-import
  delegation.

## Remaining WP-B2 work

Products is migrated, but WP-B2 is not complete. Product batches and the remaining
assessments, carbon, evidence and reports domains must be migrated in bounded increments
with the same contract and regression gates.

## Rollback

Rollback is a normal revert of this increment. No database migration or stored-data
conversion is required.
