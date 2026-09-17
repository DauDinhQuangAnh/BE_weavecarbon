# WeaveCarbon Industrial Platform Master Tracker

Baseline date: 2026-09-17

Vision source: `WeaveCarbon Mới cập nhật 12.09.docx`

Current implementation branch: `feat/g2-industrial-core-baseline`

Detailed requirement and production audit: `docs/WEAVECARBON_12_09_IMPLEMENTATION_AUDIT.md`

## Product boundary

WeaveCarbon is being rebaselined as Industrial Carbon & Climate Data Infrastructure. The existing R01-R20 work remains valuable, but is one **Export & Traceability adapter workstream**, not the whole platform.

Capability labels are contractual:

- `implemented`: working product capability with repository evidence.
- `partial`: a safe baseline exists, but the complete operating workflow does not.
- `planned`: vision only; it must not be represented as production-ready.

## Macro phases

| Phase | Scope | Current state | Exit gate |
|---|---|---|---|
| G2-00 | Rebaseline and truthful capability contract | Implemented in this branch | Versioned registry, tracker and visible workspace |
| G2-01 | Canonical industrial data model and evidence graph | Implemented | Facility/process/measurement/activity revision APIs, lineage queries and review controls |
| G2-02 | System-wide DQL and factor governance | Implemented | Versioned five-dimension DQL, factor proposal/review ledgers and audit UI |
| G2-03 | Vietnam domestic GHG/MRV lifecycle | Implemented | Effective-date applicability case, measurement plan, inventory linkage and governed preparation snapshot |
| G2-04 | Mitigation and allowance/quota operations | Implemented | Immutable initiative/evidence ledgers, quantified scenarios, governed allocation references and gross-preserving position snapshots |
| G2-05 | Steel and cement Industry Packs | Partial | Versioned process taxonomy, required fields, governed-factor calculation, evidence checks and deterministic pilot fixtures implemented; independent sector-expert approval and real-facility pilot remain |
| G2-06 | WeaveNode and industrial ingestion | Partial | Ed25519 device enrollment, signed packet buffer, sequence-safe replay and evidence-bound calibration software pilot implemented; real gateway/network soak, key custody and site calibration acceptance remain |
| G2-07 | Climate risk, multi-facility and vertical scale | Partial | Evidence-bound facility/supplier screening, same-scenario portfolios and transparent carbon-climate-dependency criticality implemented; ERA5-Land/CMIP6 ingestion, calibrated hazards, specialist review and vertical pilots remain |
| G2-08 | Dynamic allocation and domestic-to-export lineage | Implemented software baseline | Versioned facility/process/batch/product allocation rules, deterministic reconciled runs, immutable line lineage, API/UI and tests; real-facility reproducibility and adapter acceptance remain |
| G2-09 | Governed AI/OCR promotion | Implemented software baseline | OCR output stays non-authoritative until a named human confirms every field against the exact evidence and extraction checksums; semantic mapping/anomaly suggestions and controlled activity promotion remain |
| G2-10 | WeaveNode operational management | Implemented software baseline | Protocol-v2 source/gateway timestamps, device health, immutable meter hierarchy/reconciliation and signed staged firmware/configuration update ledgers implemented; real gateway, mTLS/key custody and OTA rollback acceptance remain |
| G2-11 | Supplier network and carbon-climate criticality | Implemented software baseline | Immutable tenant-bound supplier/site/relationship records, evidence-backed supplier climate and carbon inputs, approved weighted models, deterministic criticality snapshots and coverage-explicit portfolios implemented; real supplier data and climate-specialist acceptance remain |
| G2-12 | Industry Pack expansion | Planned | Textile, aluminium, construction materials, fertiliser/chemicals and mining/minerals packs with expert and real-facility evidence |
| G2-13 | Enterprise security and production acceptance | Planned | MFA/SSO, incident/key controls, real-data pilot, CI/CD release gate, migration/rollback proof and production smoke tests |

## This baseline delivers

- Additive immutable schemas for facility, process, measurement point and activity records.
- Tenant-bound references and activity-to-evidence links.
- Required activity provenance (`source_sha256`) and DQL (`L1`-`L5`).
- Authenticated capability, facility and activity APIs.
- Process and measurement-point revision APIs, activity evidence lineage and immutable review decisions.
- A UI workspace that clearly separates implemented, partial and planned capability.
- Governed WeaveNode operations with dual-time provenance, signed health reports, evidence-bound meter hierarchy reconciliation and signed staged update/rollback history.
- Governed supplier-network records and deterministic carbon + climate + business-dependency criticality snapshots with explicit selected-subject coverage.

This baseline does **not** claim authority submission, registry ownership/transfer/surrender, expert-approved Industry Packs, production-grade WeaveNode telemetry or validated physical climate-risk forecasts.
