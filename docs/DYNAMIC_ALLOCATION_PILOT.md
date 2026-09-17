# G2-08 Dynamic Allocation Pilot

Status: software baseline. It records deterministic allocation lineage but is not an approved product footprint, regulatory submission or external environmental claim.

## Control model

An allocation rule is an immutable revision bound to one company and facility revision. It moves only forward through the supported hierarchy:

- facility to process, batch or product;
- process to batch or product;
- batch to product.

Every rule records the driver method and unit, methodology reference and version, rationale and a SHA-256 identity. A rule marked `approved` requires non-empty locked or independently verified evidence with an exact checksum. Draft rules cannot create runs.

## Deterministic run

`POST /api/dynamic-allocation/runs` accepts exactly one source: an industrial activity or an existing allocation line. Using an allocation line as the next source creates the multi-level chain without overwriting the previous level.

Targets must belong to the active company. Process targets must also belong to the rule facility. Targets are sorted by identifier before calculation, driver values must be positive and the final line receives any eight-decimal rounding residual. A run is persisted only when allocated quantity reconciles to the source within `0.00000001`.

The immutable run snapshots the source, rule, evidence checksum, driver total, allocation lines and payload hash. Repeating the exact governed input returns the existing run instead of creating a conflicting duplicate.

## API surface

- `GET /api/dynamic-allocation/rules`
- `POST /api/dynamic-allocation/rules`
- `GET /api/dynamic-allocation/runs`
- `GET /api/dynamic-allocation/runs/{runId}`
- `POST /api/dynamic-allocation/runs`

The Carbon Operations workspace supports the common facility-to-process workflow. The API also supports process-to-batch/product and batch-to-product continuation.

## Acceptance still required

Use a real facility period and approved allocation SOP; reproduce the same run independently; review driver completeness and sensitivity; continue at least one line through process to batch/product; bind the final lines into a PCF or buyer adapter; obtain a named methodology reviewer decision. Keep all external claims outside the baseline until those checks pass.
