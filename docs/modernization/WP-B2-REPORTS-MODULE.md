# WP-B2 - Reports Module Migration

Increment status: PASS

Reports domain status: MIGRATED

WP-B2 overall status: COMPLETE

## Scope

This increment migrates the complete `/api/reports` capability into the `reports`
feature module: report CRUD/status/download, unified dataset export, export-source
counts and raw data, V2 templates/snapshots, CSV/XLSX generation, PDF rendering and
the recoverable background report queue.

No route path, operation order, request/response payload, validation rule, database
schema, report storage key, file format or deployment topology is changed.

## Resulting boundary

```text
Reports router + validation
            |
            v
      ReportsService --------> shared database/analytics ports
            | \
            |  +-------------> PDF report service
            v
      ReportJobQueue --------> transitional compliance-report port
```

- `routes.js` owns authentication/role middleware, HTTP response mapping, guarded
  download behavior, audit intent and the existing development-only placeholder flow.
- `validation.js` keeps all list, create, export, ID and status request contracts beside
  the owning routes.
- `service.js` owns report queries, transactions, company scoping, export mapping,
  storage orchestration and analytics intent.
- `pdfService.js` owns the four PDF renderers and their legacy report-type aliases.
- `jobQueue.js` owns startup recovery, concurrency, deduplication and dispatch of
  dataset, manual and market-compliance report tasks.
- The service, PDF renderer and job queue expose dependency-injection factories for
  isolated tests while preserving the runtime singleton exports.
- `index.js` is the module's only public surface. Previous route, service, validator,
  helper, PDF and queue paths remain one-line compatibility exports.
- Database, runtime configuration, security, validation, analytics, auditing and
  logging are consumed through shared ports. Market-compliance generation is retained
  behind a transitional shared adapter until that reference domain is replaced.

## Preserved behavior and safety

- All fourteen Reports operations remain mounted in their original order and paths.
- B2B authentication, company scoping, filters, pagination defaults, safe sort-field
  allowlisting and error contracts remain unchanged.
- Dataset exports retain their supported source types and CSV/XLSX formats.
- PDF generation retains product-carbon, batch-export, facility-emission and compliance
  renderers plus the older carbon-audit and sustainability aliases.
- Startup still recovers unfinished report rows; queue keys still prevent duplicate
  work for the same task type and report ID.
- Report files remain under `UPLOADS_ROOT`, and download/delete path containment checks
  are unchanged.
- The count query now receives an immutable parameter snapshot before pagination values
  are appended, avoiding mutable parameter aliasing without changing SQL behavior.

## Verification evidence

- Reports verification: 4 suites / 13 tests passed with `--detectOpenHandles`.
- Full backend verification: 64 suites / 449 tests passed.
- Syntax check: 194 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- Lint passed with no warnings or errors.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact remained current with SHA-256
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.
- Tests cover all fourteen route operations, legacy import identity, company-scoped
  filtering/pagination, connection release, job recovery, task mapping and queue
  deduplication.

## WP-B2 completion

Reports was the final planned major-domain migration. Auth, Organizations, Products,
Assessments/Product Batches, Carbon, Evidence and Reports now have explicit feature
boundaries; Suppliers/Compliance remains the established reference implementation and
Shared remains the cross-cutting infrastructure boundary.

Further modernization should be planned as a new work package rather than extending
WP-B2.

## Rollback

Rollback is a normal revert of this increment. No database migration or stored-data
conversion is required. Existing report rows, generated files, storage keys and queued
work remain compatible.
