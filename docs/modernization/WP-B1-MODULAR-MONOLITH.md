# WP-B1 — Backend Modular-Monolith Skeleton

Status: PASS

## Outcome

The backend remains one Express/PostgreSQL deployment. A feature-oriented skeleton now exists under `src/modules/` for:

- auth
- organizations
- products
- assessments
- carbon
- evidence
- reports
- suppliers/compliance
- shared infrastructure

Each module owns a `module.json` boundary manifest. Suppliers/compliance is the only reference implementation migrated in this work package. The stable `src/routes/suppliers.js` entry point is retained as a compatibility export, so `src/config/apiRoutes.js`, mount order and all `/api/suppliers` paths remain unchanged.

## Dependency direction

```text
HTTP route -> application service -> repository -> shared database adapter
                      |
                      +-----------------------> shared auditing port
```

Rules enforced by `npm run architecture:check`:

1. Feature modules may import their own files, declared modules and third-party packages.
2. Feature modules must not escape `src/modules/` to import legacy routes, services, config, middleware or utilities directly.
3. Feature-to-feature imports are denied unless explicitly declared; current feature manifests allow only `shared`.
4. `shared` owns transitional adapters to existing infrastructure. It must not contain feature business rules.
5. Legacy code may import a module only through its public `index.js` compatibility surface.

Planned modules are manifests only. Moving their business logic is intentionally deferred to bounded follow-up packages.

## Reference module

`src/modules/suppliers-compliance/` demonstrates:

- `routes.js`: HTTP/auth/input and response boundary.
- `service.js`: application orchestration, payload mapping and audit intent.
- `repository.js`: PostgreSQL queries.
- `index.js`: public module surface.

SQL statements, status rules, audit events and camelCase response fields were preserved from the previous route implementation.

## Verification evidence

- Baseline: 25 suites / 270 tests; 109 JavaScript files passed syntax check.
- After migration: 27 suites / 276 tests; 117 JavaScript files passed syntax check.
- Module boundary gate: 9 manifests, exactly 1 reference implementation, 0 violations.
- Startup wiring: `/api/suppliers` resolves `GET /`, `POST /`, `PUT /:id`, and `DELETE /:id` through the compatibility export.
- OpenAPI before and after: 130 paths, 166 documented operations, 165 mounted runtime operations.
- OpenAPI artifact SHA-256 before and after: `9DFDF530EA41D08103A5A2CC43CB2039D6E005253742BB37E3307E04F0EDB03B`.
- `npm run verify:full`: syntax, OpenAPI semantic/parity/staleness, module boundaries, lint and all tests passed.
- `npm run build:release`: passed.

## Remaining risk and rollback

Only suppliers/compliance follows the pattern today. Existing domains remain in the legacy folders and must be migrated one at a time with their own contract evidence. The shared adapters intentionally depend on legacy infrastructure during transition.

Rollback is a normal revert of the WP-B1 commit. No database schema, stored data, route path or deployment topology changes are involved.
