# WeaveCarbon 12 September Vision Implementation Audit

Audit date: 2026-09-18
Source of truth: `WeaveCarbon Mới cập nhật 12.09.docx`  
Implementation branch reviewed: `feat/g2-industrial-core-baseline`

## Audit conclusion

The branch is moving in the right architectural direction, but it does not yet implement the complete vision in the 12 September document. The implemented work is a credible software baseline through G2-14: canonical industrial records, evidence lineage, data-quality and factor governance, domestic MRV preparation, mitigation and allowance references, seven governed Industry Pack pilots, dynamic allocation, governed OCR review and controlled activity promotion, operational WeaveNode controls, climate-risk screening, supplier-network governance, transparent carbon-climate-dependency criticality, MFA and governed enterprise-security/production-acceptance controls.

The remaining work is not a small polish pass. G2-14 closes the controlled OCR-to-activity software gap, but representative-document/model evaluation and real external acceptance evidence still require explicit delivery phases. Climate criticality, sector packs, AI accuracy, external SSO interoperability and production acceptance may not be represented as complete until their documented external gates pass.

Production is also behind this branch. At the 2026-09-18 checkpoint, the production database stopped at migration `024`; migrations `038` through `052` and the G2 industrial-core, WeaveNode, climate-risk, enterprise-security and controlled AI-promotion routes were absent from the running backend image.

## Requirement-by-requirement status

| Vision requirement | Repository evidence | Status | Required next proof |
|---|---|---|---|
| Eight-step workflow from collection through decision support | Evidence upload, canonical activity records, DQL, reviews, MRV/export adapters and decision pilots exist | Partial | One end-to-end real-facility pilot proving reuse of the same source records through all applicable steps |
| Canonical industrial data model | Facility, process, measurement point and activity revision ledgers plus existing product, batch, supplier, transport and evidence models | Implemented baseline | Complete explicit emission-source, resource/energy, methodology and target-requirement entities |
| Carbon Evidence Graph | Activity-to-evidence lineage and immutable review snapshots | Partial | Cross-workstream traversal through factor, allocation, calculation, reviewer and version |
| Deterministic calculation | Factor registry, calculation snapshots, PCF and corporate inventory controls | Implemented baseline | Reproducibility gate across the new allocation hierarchy and domestic-to-export reuse |
| Dynamic multi-level allocation | Versioned facility/process/batch/product rules, deterministic reconciled runs and immutable line lineage | Implemented software baseline | Real-facility reproducibility and domestic-to-export adapter acceptance |
| Domestic GHG inventory and MRV | Effective-date applicability, measurement plans, inventory linkage and filing-readiness snapshots | Implemented software pilot | Real facility, named expert/verifier review and authority-channel acceptance evidence |
| Mitigation and allowance/quota operations | Immutable initiative, scenario, allocation-reference and gross-preserving position ledgers | Implemented software pilot | Registry reconciliation and specialist pilot; no ownership, transfer or surrender claim |
| Export and traceability reuse | R01-R20 export workstream, PCF and buyer/target adapters | Implemented adapters | Demonstrate reuse from the canonical domestic records without re-entry |
| DQL and factor governance | Five-dimension versioned DQL and evidence-gated factor proposal/review | Implemented baseline | Apply DQL gates consistently to filing, allocation and export handoffs |
| AI/OCR with human in the loop | Checksum-bound named field review, deterministic versioned semantic suggestions, factor/calculation exclusion, warning/evidence-match decisions, immutable candidates and a separate named promotion transaction | Implemented software baseline | Representative-document accuracy and model/version evaluation, real-facility human acceptance and external security/privacy review |
| WeaveNode identity, buffering and calibration | Ed25519 v1/v2 identity, dual timestamps, signed packet/health ledgers, ordered replay, evidence-bound hierarchy reconciliation, release keys and staged update/rollback history | Implemented software baseline | Real connectivity adapter, gateway/network soak, mTLS and key custody, on-device signed OTA/rollback and site acceptance |
| Industry Packs | Seven versioned manifests: steel, cement, textile/apparel, aluminium, construction materials, fertiliser/chemicals and mining/minerals; each defines taxonomy, context, activity requirements, evidence, validation, allocation and target mappings with deterministic fixtures | Partial | Independent sector-expert approval and real-facility validation for every pack; multi-product/co-product allocation remains governed by G2-08 rather than assumed by the pack pilot |
| Climate-risk intelligence | Evidence-bound facility/supplier sites and hazard screening, immutable supplier dependency facts, approved weighted models, deterministic carbon-climate-dependency snapshots and coverage-explicit portfolios | Partial | Licensed/versioned data ingestion, calibrated hazards, climate-specialist validation and real facility/supplier acceptance evidence |
| Security and data governance | RBAC, tenant-bound access, TOTP MFA with recovery and session binding, evidence-backed OIDC configuration validation, key/incident ledgers, TLS deployment, audit trails, backup/restore and exact-release smoke controls | Partial | Production administrator enrollment/key custody, external IdP interoperability, at-rest encryption evidence, penetration test, incident-response exercise and enterprise SLA acceptance |
| Commercial package boundaries | Pilot, core modules and add-on surfaces exist in code | Partial | Enforced Starter/Growth/Enterprise entitlements, SSO/API packaging and SLA instrumentation |

## Corrected delivery phases

The existing G2-00 through G2-07 work remains valid. The following phases make the unimplemented Word scope explicit instead of hiding it inside a broad “scale” label.

| Phase | Scope | Current state | Exit gate |
|---|---|---|---|
| G2-08 | Dynamic allocation and domestic-to-export lineage | Implemented software baseline | Versioned multi-level rules, deterministic reconciled runs, immutable line lineage, API/UI and tests; real-facility reproducibility and adapter acceptance remain |
| G2-09 | Governed AI/OCR field review | Implemented software baseline | Checksum-bound named human review and immutable field decisions implemented; the downstream semantic/promotion continuation is delivered in G2-14 |
| G2-10 | WeaveNode operational management | Implemented software baseline | Dual timestamps, health, immutable hierarchy/reconciliation and signed staged firmware/configuration update/rollback controls implemented; hardware/network/mTLS acceptance remains |
| G2-11 | Supplier network and carbon-climate criticality | Implemented software baseline | Immutable tenant-bound supplier/site/relationship records, evidence-backed climate/carbon inputs, approved transparent weights, deterministic snapshots and coverage-explicit portfolios; real supplier and specialist acceptance remain |
| G2-12 | Industry Pack expansion | Implemented software baseline | Five expansion packs plus retained steel/cement define governed manifests and deterministic pilot snapshots; independent expert and real-facility acceptance remains |
| G2-13 | Enterprise security and production acceptance | Implemented software baseline | TOTP MFA, MFA-bound sessions, OIDC validation registry, key/incident ledgers, immutable acceptance records, migration 051 and exact-release smoke gates implemented; production deployment, real IdP/penetration/incident exercise and real-data acceptance remain |
| G2-14 | Controlled AI/OCR activity promotion | Implemented software baseline | Migration 052, versioned semantic mapping, anomaly/evidence-match decisions, factor/calculation exclusion, immutable candidate/promotion ledgers, API/UI and isolated PostgreSQL pilot implemented; representative-document/model evaluation and real-facility acceptance remain |

## Local G2-14 verification checkpoint

Verified on 2026-09-18 against the exact local worktree:

- Backend syntax passed for 288 JavaScript files; OpenAPI passed with 258 paths, 352 operations and 349 runtime-operation matches; module boundaries and lint passed.
- All 175 backend Jest suites and 949 tests passed.
- Migration 052 applied locally and the guarded PostgreSQL promotion pilot passed, including L5 overclaim blocking, separate promotion, idempotency, tenant-bound foreign keys, immutability and authoritative activity/evidence lineage.
- Frontend lint completed with the same 20 pre-existing non-blocking warnings and no errors; type, OpenAPI contract, network-boundary, performance-policy and release-evidence checks passed.
- All 72 frontend Vitest files and 266 tests passed; the optimized production build completed all 76 routes.

These are repository and isolated synthetic-pilot results. They do not change the production checkpoint below and are not evidence of a deployed release or representative-document AI accuracy.

## Production checkpoint

Observed on 2026-09-18 using read-only checks:

- Backend repository: `main` at `51d568c2c765c59977b11066febe7ed4de27eef3`.
- Frontend repository: `main` at `9bd4c58f58cfff8b32a2bea580675b170931c751`.
- Backend, frontend, database, proxy and RAG containers were running with zero restarts; application containers reported healthy.
- Database latest applied migration was `024_r03_carrier_document_controls.sql`.
- G2 migrations `038` through `052` were not present in the host checkout.
- Running backend did not contain the industrial-core, WeaveNode, climate-risk, enterprise-security or controlled AI-promotion route modules.
- Public site and `/health` returned HTTP 200. `/ready`, `/version` and the enterprise-security posture endpoint returned 404 because the deployed image and proxy predate G2-13.
- The production proxy routes only `/api/*` and `/health` to the backend. The branch now adds `/ready` and `/version` to both production and staging Caddy routes and enforces those paths in CI.
- Production `.env.vps` has no `MFA_ENCRYPTION_KEY`. The branch now requires a valid 32-byte hex/base64 key for backend/full deployments and passes it to the backend container; production deployment must not begin until operators generate and securely custody that key.
- A no-stream resource sample showed approximately 80 MiB each for backend and frontend, 32 MiB for PostgreSQL and 17 MiB for Caddy, with negligible CPU. This supports current runtime stability but is not load-test or SLA evidence.
- Frontend log errors were malformed Next.js Server Action probes. Sampled proxy errors targeted the unrelated `sslip.io`/Airweave virtual host, not ordinary WeaveCarbon traffic. Two defunct Node children remain under a separate long-running containerized Node process and require host-maintenance follow-up.
- The OS reported 29 available updates and a required restart. No restart, package change, pull, push or deployment was performed during the audit.

## Release decision

Do not describe G2 as deployed. Complete the implementation and verification gates, push reviewed branches, merge through `main`, let CI/CD build immutable images, then verify migrations, route contracts, health, logs and rollback state on production. Production credentials must be rotated because they were shared in conversation.
