# WP-B2 - Evidence Module Migration

Increment status: PASS

Evidence module status: MIGRATED

WP-B2 overall status: IN PROGRESS

## Scope

This increment migrates the complete `/api/evidence` capability into the `evidence`
feature module: metadata CRUD, product lookup, verification/lock/confirm aliases,
extraction status/fields, multipart upload, durable local storage, RAG ingest and
background AI extraction.

No route path, request/response payload, upload limit, RAG collection rule, database
schema, storage-key format, cleanup policy or deployment topology is changed.

## Resulting boundary

```text
Evidence router (HTTP/multipart/RAG presentation)
                    |
                    v
             EvidenceService
                    |
                    v
          EvidenceRepository ----> shared database port
                    |
                    +------------> guarded file storage
```

- `routes.js` owns authentication/role middleware, the 20 MiB memory upload boundary,
  HTTP response mapping, audit intent and the existing non-blocking extraction/RAG
  background flow.
- `service.js` owns payload normalization, evidence mapping, product ownership checks,
  status/field mapping and delete/file-cleanup orchestration.
- `repository.js` owns all Evidence SQL, pagination/count queries, company scoping,
  linked-invoice cleanup and evidence-row deletion.
- `fileStorage.js` retains the WP-S1 path guard, UUID company partitioning, atomic
  partial-file rename, restrictive permissions and safe removal behavior.
- Repository and service factories provide isolated test seams while singleton exports
  preserve runtime behavior.
- `index.js` is the module's only public surface. The previous route, service and
  storage paths remain one-line compatibility exports.
- RAG, auditing, security, runtime configuration and logging are consumed through
  shared transitional ports.

## Preserved behavior and safety

- All eleven Evidence operations remain mounted with the same order and paths.
- Product IDs are still validated as UUIDs and scoped to the authenticated company.
- List filters, pagination defaults/limits and frontend response field names are
  unchanged.
- Upload still stores the original bytes before inserting metadata and removes the new
  file if persistence fails or the document name is invalid.
- Storage keys remain under `evidence/<company>/<year>/`; traversal outside
  `UPLOADS_ROOT` remains rejected.
- AI extraction and RAG ingest remain fire-and-forget after upload, so neither blocks
  the upload response.
- Extraction failures continue to persist a user-facing reason and warnings; RAG ingest
  failure remains non-fatal.
- Verify, lock and confirm continue to use the same locked persistence state and their
  existing audit event mappings.
- Delete still removes linked electricity/fuel invoices first, then Evidence metadata,
  followed by best-effort local-file cleanup. File cleanup failure does not undo a
  successful database deletion.

## Verification evidence

- Evidence verification: 4 suites / 16 tests passed with `--detectOpenHandles`,
  including the existing WP-S1 storage safety suite.
- Full backend verification: 61 suites / 441 tests passed.
- Syntax check: 186 JavaScript files passed.
- Module boundary gate: 9 manifests, 1 reference implementation, 0 violations.
- Lint passed with no warnings or errors.
- OpenAPI parity: 130 paths, 166 documented operations and 165 mounted runtime
  operations.
- OpenAPI artifact remained current with SHA-256
  `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- Frontend OpenAPI snapshot and generated-type compatibility check passed.
- Release build completed successfully.
- Tests cover all eleven route operations, company-scoped SQL, normalized creation,
  extraction status/fields, cascade order, atomic storage and cleanup failure handling.

## Remaining WP-B2 work

Evidence is migrated, but WP-B2 is not complete. Reports is the remaining planned major
domain and must pass the same contract, regression and deployment gates.

## Rollback

Rollback is a normal revert of this increment. No database migration or stored-data
conversion is required. Existing Evidence files and storage keys remain compatible.
