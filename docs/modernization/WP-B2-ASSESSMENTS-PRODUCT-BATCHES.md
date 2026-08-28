# WP-B2 - Assessments Product-Batches Migration

Increment status: PASS

Assessments module status: MIGRATED

WP-B2 overall status: IN PROGRESS

## Scope

This increment migrates the product-batch capability mounted at
`/api/product-batches` into the `assessments` feature module. It includes the Express
route, request validators, batch persistence/application service, item transactions,
domestic-compliance publish gate and optional shipment construction.

No route path, request/response payload, validation rule, error/status code, database
schema, emission factor or deployment topology is changed.

## Resulting boundary

```text
Product-batches route + validators
                |
                v
         BatchesService
                |
                +----> shared database port
                +----> shared domestic-compliance port
```

- `batchesRoutes.js` owns authentication/role middleware, HTTP input extraction,
  response mapping and the existing batch-error translation.
- `batchesValidators.js` keeps all previous validation chains beside the feature.
- `batchesService.js` owns list/detail mapping, batch and item persistence,
  transaction boundaries, total recalculation, compliance validation and shipment
  construction.
- A narrow `createBatchesService` dependency-injection factory supports isolated
  database and compliance tests while retaining the existing singleton API.
- `index.js` is the module's only public surface and lazily exposes the router,
  singleton, factory and validators.
- The previous route, service and validator paths remain one-line compatibility
  exports for existing callers and startup wiring.

## Preserved behavior

- All nine existing operations remain mounted: list, detail, create, update, archive,
  add/update/delete item and publish.
- Company and B2B-role enforcement, pagination/filter mapping and response field names
  are unchanged.
- Missing-batch/product/item, duplicate-item, empty-batch and already-published error
  mappings are unchanged.
- Item mutations still run in transactions, recalculate aggregate totals and roll back
  on any failure.
- Publish still validates domestic documentation before changing status or creating a
  shipment.
- Transport-mode aliases, emission factors, haversine distance calculation and shipment
  skip reasons are unchanged.
- Multimodal batches without explicit leg distances continue to publish without a
  generated shipment and return the existing explanatory result.

## Verification evidence

- Assessments/Product Batches: 2 suites / 8 tests passed, including a clean
  `--detectOpenHandles` run.
- Full backend verification: 55 suites / 412 tests passed.
- Syntax check: 172 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- Lint passed with no warnings or errors.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- The generated OpenAPI artifact remained current with SHA-256
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.
- Compatibility tests prove identity for all legacy entrypoints and the complete
  nine-operation route surface.
- Service tests cover public mapping, transaction rollback/release, compliance failure
  and deterministic shipment-leg behavior.

## Remaining WP-B2 work

Products and Assessments/Product Batches are migrated, but WP-B2 is not complete.
Carbon, evidence and reports remain planned and must be migrated in bounded increments
with the same contract and regression gates.

## Rollback

Rollback is a normal revert of this increment. No database migration or stored-data
conversion is required.
