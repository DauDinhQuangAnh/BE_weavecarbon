# WP-CARB2 - Backend Pure Carbon Calculation Core

Work package status: PASS

Carbon authority status: UNCHANGED (frontend remains authoritative)

## Scope

This work package ports the existing textile PCF methodology to deterministic,
side-effect-free CommonJS modules under `src/modules/carbon/core`. It does not add an
HTTP endpoint, read or write the database, alter persisted calculations, change the
OpenAPI contract, or switch runtime authority away from the frontend.

The port preserves the frozen WP-CARB1 contract:

- fixture version: `carbon-golden-v1`;
- rule engine: `scope-quality-rss-1.0.0`;
- calculation graph: `textile-pcf-2.1.0`;
- methodology: `WeaveCarbon Attributional Textile PCF v2.1 - climate-only partial CFP`;
- factor set: 64 immutable V1 records.

## Pure-core design

| Concern | Module |
| --- | --- |
| input cloning, numeric helpers and rounding | `normalization.js` |
| structural validation | `validation.js` |
| immutable factors, aliases and fallback resolution | `factorRegistry.js` / `factors.v1.json` |
| materials, packaging, manufacturing/energy and transport | `stages.js` |
| stage accumulation and quality classes | `stageModel.js` |
| aggregation and boundary totals | `aggregation.js` |
| RSS uncertainty | `uncertainty.js` |
| data-quality and confidence scoring | `quality.js` |
| orchestration and result contract | `engine.js` |

The calculation core imports only its sibling pure modules and static factor data. It
has no Express, HTTP, PostgreSQL, repository, service, environment-variable, clock or
random dependency. Inputs are cloned before use. A deeply frozen fixture can be
calculated repeatedly with identical output and no mutation.

`src/modules/carbon/index.js` exposes the core through a lazy getter for future module
integration. Existing carbon routes, services and persistence remain untouched.

## Numerical parity

The backend runs the five WP-CARB1 inputs through the new implementation and compares
the same stable projection with exact Jest `toEqual` semantics. All five pass without
changing a formula, expected value or fixture:

| Case | Per-product total | Batch total | Result |
| --- | ---: | ---: | --- |
| documented-multistage-manufacturer | 4.577 | 5492.40 | exact match |
| direct-fuel-scope1 | 6.869 | 68.69 | exact match |
| brand-proxy-defaults | 1.743 | 87.15 | exact match |
| coverage-yield-normalization-edge | 11.106 | 11.11 | exact match |
| zero-invalid-input-edge | 0 | 0 | exact match |

The projection covers stage and batch totals, boundary totals, Scope 1/2/3,
uncertainty, confidence, data quality, energy/stage breakdowns, factor identity and
versions, calculation trace and proxy notes.

Fixture SHA-256 values remain identical to WP-CARB1:

- inputs: `87C7A13E258D77F79225433C6D5FA2FFD9260AA1279649A6BFA19FCFB3717E1A`;
- expected: `E86DB5B81AF922D0647BDFB6F7AD8A8B0F74B71F2F571C960CBF529EE05B4842`.

The factor registry is also pinned with a line-ending-independent canonical JSON
SHA-256: `29B1E378F5B1646E73CF6B693EBEC00868F5A8DF4209EFE49B5A33A5FC4F71E5`.

## Verification evidence

- New pure-core suites: 2 suites / 10 tests passed, including 5 exact golden cases.
- Entire carbon module: 5 suites / 26 tests passed.
- Full backend: 66 suites / 459 tests passed.
- Syntax: 204 files checked.
- OpenAPI: 130 paths / 166 operations; artifact current and 165 runtime operations matched.
- Architecture: 9 modules checked; boundaries passed.
- ESLint: passed with zero errors.
- Frontend/backend OpenAPI snapshot and generated types: current.
- Runtime release build: passed.
- `git diff --check`: passed.

Expected error logs emitted by negative-path tests do not represent test failures.

## Change policy and remaining dependency

Do not silently update the copied V1 factor registry or golden expected outputs. A
future intended methodology change must add a new version and document accepted
numeric drift.

WP-CARB2 unlocks WP-CARB3 together with the already completed WP-C2. WP-CARB3 may
expose the core through the existing API architecture, recompute authoritative results
server-side before persistence, and migrate frontend flows. Until WP-CARB3 passes,
client/server authority and current production behavior deliberately remain unchanged.

## Rollback

Revert this work package. The new core, fixtures, tests and documentation can be
removed together, and the lazy `core` getter can be removed from the carbon module
index. No database restore, data migration or API rollback is required because this
phase changes no runtime route or persisted record.
