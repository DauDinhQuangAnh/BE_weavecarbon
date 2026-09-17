# WeaveCarbon 12 September Vision Implementation Audit

Audit date: 2026-09-17  
Source of truth: `WeaveCarbon Mới cập nhật 12.09.docx`  
Implementation branch reviewed: `feat/g2-industrial-core-baseline`

## Audit conclusion

The branch is moving in the right architectural direction, but it does not yet implement the complete vision in the 12 September document. The implemented work is a credible software baseline through the 2027 MVP themes: canonical industrial records, evidence lineage, data-quality and factor governance, domestic MRV preparation, mitigation and allowance references, steel/cement pilots, signed WeaveNode ingestion and climate-risk screening.

The remaining work is not a small polish pass. Dynamic multi-level allocation, governed AI/OCR promotion, operational WeaveNode management, the wider Industry Pack set, supplier-network workflows, combined carbon-climate criticality and enterprise controls still require explicit delivery phases and acceptance evidence.

Production is also behind this branch. At the 2026-09-17 checkpoint, the production database stopped at migration `024`; migrations `038` through `045` and the G2 industrial-core, WeaveNode and climate-risk routes were absent from the running backend image.

## Requirement-by-requirement status

| Vision requirement | Repository evidence | Status | Required next proof |
|---|---|---|---|
| Eight-step workflow from collection through decision support | Evidence upload, canonical activity records, DQL, reviews, MRV/export adapters and decision pilots exist | Partial | One end-to-end real-facility pilot proving reuse of the same source records through all applicable steps |
| Canonical industrial data model | Facility, process, measurement point and activity revision ledgers plus existing product, batch, supplier, transport and evidence models | Implemented baseline | Complete explicit emission-source, resource/energy, methodology and target-requirement entities |
| Carbon Evidence Graph | Activity-to-evidence lineage and immutable review snapshots | Partial | Cross-workstream traversal through factor, allocation, calculation, reviewer and version |
| Deterministic calculation | Factor registry, calculation snapshots, PCF and corporate inventory controls | Implemented baseline | Reproducibility gate across the new allocation hierarchy and domestic-to-export reuse |
| Dynamic multi-level allocation | PCF allocation metadata and single-product Industry Pack calculation exist | Missing as a platform engine | Versioned facility to process to batch/product rules, deterministic runs, reconciliation and lineage |
| Domestic GHG inventory and MRV | Effective-date applicability, measurement plans, inventory linkage and filing-readiness snapshots | Implemented software pilot | Real facility, named expert/verifier review and authority-channel acceptance evidence |
| Mitigation and allowance/quota operations | Immutable initiative, scenario, allocation-reference and gross-preserving position ledgers | Implemented software pilot | Registry reconciliation and specialist pilot; no ownership, transfer or surrender claim |
| Export and traceability reuse | R01-R20 export workstream, PCF and buyer/target adapters | Implemented adapters | Demonstrate reuse from the canonical domestic records without re-entry |
| DQL and factor governance | Five-dimension versioned DQL and evidence-gated factor proposal/review | Implemented baseline | Apply DQL gates consistently to filing, allocation and export handoffs |
| AI/OCR with human in the loop | OCR extraction, RAG ingestion, extraction failure feedback and evidence locking exist | Partial | Field-level suggestion ledger, named approval/rejection and controlled promotion to authoritative activity data |
| WeaveNode identity, buffering and calibration | Ed25519 identity, signed packet ledger, ordered replay, revocation and calibration evidence | Partial | Connectivity adapters, dual timestamps/time sync, meter hierarchy, reconciliation, health, configuration audit and signed staged OTA |
| Industry Packs | Steel and cement pilot manifests and deterministic snapshots | Partial | Real expert/facility validation plus textile, aluminium, construction materials, fertiliser/chemicals and mining/minerals packs |
| Climate-risk intelligence | Evidence-bound locations, hazard/exposure/vulnerability screening and multi-facility portfolio snapshots | Partial | Licensed/versioned data ingestion, calibrated hazards, supplier coverage and transparent carbon-climate-business criticality |
| Security and data governance | RBAC, tenant-bound data access, TLS deployment, audit trails, backup/restore scripts and security tests | Partial | MFA for sensitive roles, SSO, at-rest encryption evidence, key lifecycle, incident-response exercise and enterprise SLA controls |
| Commercial package boundaries | Pilot, core modules and add-on surfaces exist in code | Partial | Enforced Starter/Growth/Enterprise entitlements, SSO/API packaging and SLA instrumentation |

## Corrected delivery phases

The existing G2-00 through G2-07 work remains valid. The following phases make the unimplemented Word scope explicit instead of hiding it inside a broad “scale” label.

| Phase | Scope | Current state | Exit gate |
|---|---|---|---|
| G2-08 | Dynamic allocation and domestic-to-export lineage | Implemented software baseline | Versioned multi-level rules, deterministic reconciled runs, immutable line lineage, API/UI and tests; real-facility reproducibility and adapter acceptance remain |
| G2-09 | Governed AI/OCR promotion | Planned | Suggestions never become authoritative without named human decisions and source checksum binding |
| G2-10 | WeaveNode operational management | Planned | Meter hierarchy/reconciliation, health, config audit, dual timestamps and signed staged update controls |
| G2-11 | Supplier network and carbon-climate criticality | Planned | Tenant-safe supplier coverage plus transparent carbon, climate and dependency weighting |
| G2-12 | Industry Pack expansion | Planned | Textile, aluminium, construction materials, fertiliser/chemicals and mining/minerals packs with expert pilot evidence |
| G2-13 | Enterprise security and production acceptance | Planned | MFA/SSO, key and incident controls, real-data pilot, CI/CD release gate, migration/rollback proof and production smoke tests |

## Production checkpoint

Observed on 2026-09-17 using read-only checks:

- Backend repository: `main` at `51d568c2c765c59977b11066febe7ed4de27eef3`.
- Frontend repository: `main` at `9bd4c58f58cfff8b32a2bea580675b170931c751`.
- Backend, frontend, database, proxy and RAG containers were running with zero restarts; application containers reported healthy.
- Database latest applied migration was `024_r03_carrier_document_controls.sql`.
- G2 migrations `038` through `045` were not present in the host checkout.
- Running backend did not contain the industrial-core, WeaveNode or climate-risk route modules.
- Public site and `/health` returned HTTP 200, while G2 endpoints returned 404 as expected for the old release.
- Frontend log errors were malformed Next.js Server Action probes. The sampled proxy errors targeted the unrelated `sslip.io`/Airweave virtual host and credential-file paths, not ordinary WeaveCarbon user traffic.

## Release decision

Do not describe G2 as deployed. Complete the implementation and verification gates, push reviewed branches, merge through `main`, let CI/CD build immutable images, then verify migrations, route contracts, health, logs and rollback state on production. Production credentials must be rotated because they were shared in conversation.
