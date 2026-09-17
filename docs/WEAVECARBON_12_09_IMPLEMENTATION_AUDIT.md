# WeaveCarbon 12 September Vision Implementation Audit

Audit date: 2026-09-17  
Source of truth: `WeaveCarbon Mới cập nhật 12.09.docx`  
Implementation branch reviewed: `feat/g2-industrial-core-baseline`

## Audit conclusion

The branch is moving in the right architectural direction, but it does not yet implement the complete vision in the 12 September document. The implemented work is a credible software baseline through G2-11: canonical industrial records, evidence lineage, data-quality and factor governance, domestic MRV preparation, mitigation and allowance references, steel/cement pilots, dynamic allocation, governed OCR review, operational WeaveNode controls, climate-risk screening, supplier-network governance and transparent carbon-climate-dependency criticality.

The remaining work is not a small polish pass. Controlled OCR-to-activity promotion, the wider Industry Pack set, enterprise controls and real external acceptance evidence still require explicit delivery phases. G2-11 now supplies a governed software baseline, but it must not be represented as a validated physical-risk forecast or complete supplier coverage until the documented external gates pass.

Production is also behind this branch. At the 2026-09-17 checkpoint, the production database stopped at migration `024`; migrations `038` through `048` and the G2 industrial-core, WeaveNode and climate-risk routes were absent from the running backend image.

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
| AI/OCR with human in the loop | Checksum-bound named review and immutable accepted/corrected field decisions keep extraction non-authoritative until confirmation | Partial | Semantic/anomaly suggestions and controlled promotion to authoritative activity data |
| WeaveNode identity, buffering and calibration | Ed25519 v1/v2 identity, dual timestamps, signed packet/health ledgers, ordered replay, evidence-bound hierarchy reconciliation, release keys and staged update/rollback history | Implemented software baseline | Real connectivity adapter, gateway/network soak, mTLS and key custody, on-device signed OTA/rollback and site acceptance |
| Industry Packs | Steel and cement pilot manifests and deterministic snapshots | Partial | Real expert/facility validation plus textile, aluminium, construction materials, fertiliser/chemicals and mining/minerals packs |
| Climate-risk intelligence | Evidence-bound facility/supplier sites and hazard screening, immutable supplier dependency facts, approved weighted models, deterministic carbon-climate-dependency snapshots and coverage-explicit portfolios | Partial | Licensed/versioned data ingestion, calibrated hazards, climate-specialist validation and real facility/supplier acceptance evidence |
| Security and data governance | RBAC, tenant-bound data access, TLS deployment, audit trails, backup/restore scripts and security tests | Partial | MFA for sensitive roles, SSO, at-rest encryption evidence, key lifecycle, incident-response exercise and enterprise SLA controls |
| Commercial package boundaries | Pilot, core modules and add-on surfaces exist in code | Partial | Enforced Starter/Growth/Enterprise entitlements, SSO/API packaging and SLA instrumentation |

## Corrected delivery phases

The existing G2-00 through G2-07 work remains valid. The following phases make the unimplemented Word scope explicit instead of hiding it inside a broad “scale” label.

| Phase | Scope | Current state | Exit gate |
|---|---|---|---|
| G2-08 | Dynamic allocation and domestic-to-export lineage | Implemented software baseline | Versioned multi-level rules, deterministic reconciled runs, immutable line lineage, API/UI and tests; real-facility reproducibility and adapter acceptance remain |
| G2-09 | Governed AI/OCR promotion | Implemented software baseline | Checksum-bound named human review and immutable field decisions implemented; semantic/anomaly suggestions and controlled activity promotion remain |
| G2-10 | WeaveNode operational management | Implemented software baseline | Dual timestamps, health, immutable hierarchy/reconciliation and signed staged firmware/configuration update/rollback controls implemented; hardware/network/mTLS acceptance remains |
| G2-11 | Supplier network and carbon-climate criticality | Implemented software baseline | Immutable tenant-bound supplier/site/relationship records, evidence-backed climate/carbon inputs, approved transparent weights, deterministic snapshots and coverage-explicit portfolios; real supplier and specialist acceptance remain |
| G2-12 | Industry Pack expansion | Planned | Textile, aluminium, construction materials, fertiliser/chemicals and mining/minerals packs with expert pilot evidence |
| G2-13 | Enterprise security and production acceptance | Planned | MFA/SSO, key and incident controls, real-data pilot, CI/CD release gate, migration/rollback proof and production smoke tests |

## Production checkpoint

Observed on 2026-09-17 using read-only checks:

- Backend repository: `main` at `51d568c2c765c59977b11066febe7ed4de27eef3`.
- Frontend repository: `main` at `9bd4c58f58cfff8b32a2bea580675b170931c751`.
- Backend, frontend, database, proxy and RAG containers were running with zero restarts; application containers reported healthy.
- Database latest applied migration was `024_r03_carrier_document_controls.sql`.
- G2 migrations `038` through `048` were not present in the host checkout.
- Running backend did not contain the industrial-core, WeaveNode or climate-risk route modules.
- Public site and `/health` returned HTTP 200, while G2 endpoints returned 404 as expected for the old release.
- Frontend log errors were malformed Next.js Server Action probes. The sampled proxy errors targeted the unrelated `sslip.io`/Airweave virtual host and credential-file paths, not ordinary WeaveCarbon user traffic.

## Release decision

Do not describe G2 as deployed. Complete the implementation and verification gates, push reviewed branches, merge through `main`, let CI/CD build immutable images, then verify migrations, route contracts, health, logs and rollback state on production. Production credentials must be rotated because they were shared in conversation.
