# WeaveCarbon Export Report Master Tracker

> **READ THIS FILE FIRST.** This is the canonical handoff and progress tracker for export-report work.
> It covers both the backend and frontend repositories. Update it in the same commit as every material
> report change. Do not infer legal readiness from passing unit tests or from the existence of a download button.

## 1. Mission and scope

- Base trade lane: Vietnam to the European Union.
- Base goods: apparel in CN chapters 61/62 and footwear in CN chapter 64.
- Unit of assessment: `company + product/SKU + batch/lot + shipment + market + effective date`.
- Product objective: complete and verify one report at a time until the applicable export dossier is usable.
- Integration boundary for the current phase: WeaveCarbon prepares, validates, downloads and reconciles data;
  it does not submit directly to VNACCS, EU customs, ICS2, a carrier or the CBAM Registry.
- Legal and regulatory rules must be versioned and rechecked against primary sources before release.

This tracker separates four facts that must never be conflated:

1. The required data fields exist in the data model.
2. The application can generate a file.
3. The file passed technical and business validation.
4. The document is legally usable and was issued/submitted by the correct actor.

## 2. Repository and deployment context

| Item | Value |
|---|---|
| Backend repository | `https://github.com/DauDinhQuangAnh/BE_weavecarbon.git` |
| Frontend repository | `https://github.com/DauDinhQuangAnh/weavecarbon.git` |
| Current integration branch in both repositories | `main` |
| Backend R01/R02 implementation commit | `32afddaeb088ffe2afab0af57bd0d238d849bd18` |
| Frontend R01/R02 implementation commit | `4f51dc9e372fcbf31e8228174281d5efe53617b8` |
| Frontend R14 safety commit | `af54d39040edb2f514a4b86fad1fc05e36aab9f6` |
| Backend R14 contribution-term commit | `715df83c9c082827ac9de26778b82b9e68cdd58e` |
| Frontend R14 contribution-term commit | `cf19cd5ce037d088c692e370ec1460e14c861543` |
| Backend R14 immutable-bundle commit | `f973ab101fa5fbf5149bc4a006405606218be198` |
| Frontend R14 immutable-bundle commit | `aeb19e31023b48dfcc4f5644e2a1119ad77ecdf4` |
| Backend R14 evidence-review commit | `acec186b82ea7ff8691298e16af7c76793ddc6c7` |
| Frontend R14 evidence-review commit | `56f2bf07afa3f455473502808d324e85411ca890` |
| Backend R14 isolated-pilot commit | `e2c03ad50e0ff9856d9c64cd4843bc175b0080d3` |
| Backend feature-branch CI gate commit | `e124648f41c4f9c34b556c6b8b03ab6bda31a6e2` |
| Frontend isolated-staging stack commit | `188fe3d` |
| Backend R01/R02 staging-pilot commit | `002aea9` |
| Backend PostgreSQL date-normalisation fix | `dab966c` |
| Backend R01/R02 hierarchy/PDF commit | `9934423fac24b00ceca4ad65f11cec2e2f30a5c3` |
| Frontend R01/R02 hierarchy/PDF commit | `bace2dc4f7d3929aebfd36431833c63f61e4e169` |
| Frontend critical dependency patch commit | `6016c07605e3cab56cd5c40c02dbd46193b7f2b3` |
| Backend current production commit | `4ff6bc8973733225dcca3ea76f33d5a276438994` |
| Frontend current production commit | `6016c07605e3cab56cd5c40c02dbd46193b7f2b3` |
| Production site | `https://weavecarbon.com` |
| Production state verified at 2026-09-09 | R01/R02 hierarchy/PDF changes and the frontend security patch are deployed from `main`; FE/BE checkouts match the current production commits above, all production containers are healthy, migrations 001-021 are current, `/health` is healthy and `/` returns HTTP 200 |
| Isolated staging verified at 2026-09-09 | `/opt/weavecarbon-staging`; frontend `6016c07605e3cab56cd5c40c02dbd46193b7f2b3`; dedicated DB/uploads volumes; HTTP only on `127.0.0.1:18080`; migrations 001-021 applied; DB/BE/FE healthy; guarded two-container PDF/XLSX pilot and patched frontend image scan passed |
| Production deploy behavior | A successful `main` pipeline deploys; backend startup runs migrations |

Never put server passwords, database credentials, tokens or `.env` values in this file.

### Restore context on another machine

```bash
git clone https://github.com/DauDinhQuangAnh/BE_weavecarbon.git
git -C BE_weavecarbon switch main
git clone https://github.com/DauDinhQuangAnh/weavecarbon.git
git -C weavecarbon switch main
```

Then give the next AI this instruction:

> Read `BE_weavecarbon/docs/EXPORT_REPORT_MASTER_TRACKER.md` completely. Verify the two repository HEADs,
> inspect current diffs, select only the first unfinished report in section 6, implement its Definition of Done,
> run the required tests, and update this tracker in the same commit. Do not merge or deploy until the release
> gates in section 9 pass.

## 3. Status vocabulary

| Status | Meaning |
|---|---|
| `READY_TO_PILOT` | Implementation exists and automated checks pass; still needs staging data and manual document review. |
| `INTERNAL_ONLY` | Useful draft/worksheet, but not legal, customs, assurance or authority-ready. |
| `PARTIAL` | Some model/UI/output exists, but required data or controls are missing. |
| `EXTERNAL_DOCUMENT` | WeaveCarbon must ingest/link a document issued by another authorised actor; it must not generate it as legal evidence. |
| `NOT_STARTED` | No adequate data model, workflow and output yet. |
| `NOT_APPLICABLE_BASELINE` | Not applicable to the baseline CN 61/62/64 shipment; applicability must still be screened from versioned CN rules. |
| `BLOCKED_BY_LAW` | Final schema/timing depends on a delegated act or national implementation not yet fixed. |

Only a human-approved staging pilot can promote `READY_TO_PILOT` to `READY_TO_ISSUE`. Only the correct actor and
workflow can produce `ISSUED`, `CARRIER_SUBMITTED` or `AUTHORITY_ACCEPTED`.

## 4. What the merged report increment actually completed

The report increment merged to `main` completed the shared shipment-document foundation, not the entire report programme:

- Shipment-scoped export profile, immutable line snapshot and package records.
- Versioned export documents and requirement results.
- Lifecycle support for draft/review, blocked, issued and superseded documents.
- Commercial Invoice, Packing List, Carbon Annex and Origin Workbook XLSX generation.
- Commercial Invoice and Packing List PDF generation with stable A4 landscape pagination and explicit draft marking.
- Tenant-bound container records plus container-pallet-carton package hierarchy and reconciliation.
- ICS2 support CSV generation.
- Validation for selected fields, package allocation and weight reconciliation.
- Approved/current carrier evidence requirement for Carbon Annex and ICS2 support data.
- No 20-line truncation in the new workflow.
- Legacy company-scoped invoice/packing-list/B/L endpoints retired with HTTP 410.
- Generated-file existence, size and SHA-256 checks before completion.
- Shipment snapshot hash check before issue; issued payload/file identity is immutable.
- CBAM applicability gate: ordinary CN 61/62/64 returns `CBAM_NOT_APPLICABLE`.
- DPP production guardrails for valid GS1 GTIN, public HTTPS URL and explicit operator/facility identifiers.
- Frontend shipment selection, profile/line/package editing, evidence approval and per-document readiness.

Known overall checks at the latest feature commits:

- Backend: 95/95 suites and 590/590 tests passed; `npm run verify` passed.
- Frontend: 38/38 files and 167/167 tests passed; `npm run check` and production build passed.
- Backend CI run `34289284974` passed all six jobs on disposable PostgreSQL 16. It loaded the base schema, seeded the legacy
  fixture, applied every migration through 020, passed immutable snapshot/M1/M4 checks, the guarded Audit Pack lifecycle
  pilot, hot-query audit, backup/restore drill and API integration. The `audit-pack-pilot-34289284974` result artifact is
  retained by CI for 14 days. This proves the synthetic integration gate, not a human real-data staging approval.
- On the isolated VPS staging database, the guarded Audit Pack pilot passed and the guarded R01/R02 pilot issued and
  reopened a 25-line Commercial Invoice plus a 50-carton Packing List. The latest R01/R02 run used two containers,
  two pallets and 50 cartons and verified both PDF and XLSX outputs. These are synthetic technical pilots; neither is a
  human trade/warehouse approval.

## 5. Master dossier matrix

| # | Report/document | Applicability | Current status | Current capability | Next gate |
|---:|---|---|---|---|---|
| 1 | Commercial Invoice | Almost every sale shipment | `READY_TO_PILOT` | Shipment PDF/XLSX, invoice identity/place, party/contact, HS confirmation, adjustments and immutable issue | Named export-operator review against an actual invoice and buyer/destination rules |
| 2 | Packing List | Normal customs/transport practice | `READY_TO_PILOT` | PDF/XLSX, container-pallet-carton hierarchy, partial cartons, CBM and quantity/net/gross reconciliation | Explicit grouped-weight semantics and named warehouse physical-pack review |
| 3 | B/L, AWB, CMR or FBL | Depends on transport mode | `EXTERNAL_DOCUMENT` | Upload, link and approve carrier evidence; WeaveCarbon generates only Carbon Annex | Carrier metadata validation and real document pilot |
| 4 | Vietnam export declaration/VNACCS | Normally mandatory | `NOT_STARTED` | Stores declaration number only | Build broker/VNACCS support dataset and response lifecycle |
| 5 | EU import declaration/SAD/EUCDM | Importer/declarant responsibility | `NOT_STARTED` | No declaration dataset | Build declarant handoff dataset; never label it customs-accepted |
| 6 | ENS/ICS2 support dataset | Goods entering EU | `PARTIAL` | Basic per-line CSV | Mode/release-specific schema, house/master consignment and schema validation |
| 7 | EVFTA EUR.1/origin declaration support | Only when claiming preference | `PARTIAL` | Basic Origin Workbook plus locked supporting evidence gate | BOM-origin rules engine and official-form/wording workflow |
| 8 | EU textile fibre label | Textile products | `PARTIAL` | Generic material composition exists | Controlled Annex-I fibres, components, locale and label artifact |
| 9 | EU footwear material label | Footwear products | `NOT_STARTED` | No three-part/80% model | Component model, 80% rule, pictogram/text and locale output |
| 10 | GPSR technical file and traceability | Consumer products | `PARTIAL` | Some product identity/passport/evidence fields | Risk file, EU operator, warnings, tests and corrective-action records |
| 11 | REACH/SVHC dossier | Conditional by substance/material/threshold | `PARTIAL` | Generic evidence/document records | Substance-level model, list version, thresholds, lab and safe-use output |
| 12 | Product Carbon Footprint/ISO 14067 support | Buyer/tender/claim dependent | `INTERNAL_ONLY` | Server-authoritative partial PCF PDF/XLSX | Goal/scope, functional unit, DQ, allocation, uncertainty and assurance gate |
| 13 | Corporate/facility GHG report | Buyer/ESG/assurance dependent | `INTERNAL_ONLY` | Electricity/fuel worksheet | Organisational boundary, full sources/gases, base year and exclusions |
| 14 | Audit/evidence pack | Buyer or verifier dependent | `PARTIAL` | Immutable ZIP, exact term/factor evidence coverage, append-only review/internal issue, and isolated PostgreSQL pilot gate | Run human real-evidence staging review; signed share link and external assurance |
| 15 | Apparel & Footwear PEF/PEFCR | Voluntary or buyer-specific | `NOT_STARTED` | Climate-only partial PCF is not PEF | Full life cycle, EF datasets/impact categories and validation statement |
| 16 | ESPR Digital Product Passport | When product delegated act applies | `BLOCKED_BY_LAW` | Guarded prototype only | Registry/service/access/version architecture; wait for final product schema |
| 17 | Textile/footwear EPR reporting | Member-State implementation | `BLOCKED_BY_LAW` | Static requirement label only | Country registry, producer/PRO identity and placed-on-market ledger |
| 18 | Green-claim substantiation dossier | Whenever environmental claims are made | `NOT_STARTED` | Carbon output exists without claim controls | Claim register, evidence binding, approval and withdrawal triggers |
| 19 | CBAM declaration/operator report | Annex-I CBAM goods only | `NOT_APPLICABLE_BASELINE` | Scope screening; old styled templates remain demo-only | Maintain versioned CN list; implement official fields only for Annex-I goods |
| 20 | Specialist permits/certificates | Conditional by exact product and lane | `NOT_STARTED` | Static checklist only | Versioned applicability engine using exact SKU/lane attributes |

No item in this matrix is currently confirmed `READY_TO_ISSUE` on production.

## 6. Per-report acceptance backlog

Work in the order below. Finish one report and update its status before starting another, except where a shared data
model is explicitly required by the next two reports.

### R01 — Commercial Invoice

**Applicability/authority/format:** exporter-issued for almost every sale shipment. EU has no single mandatory visual
template; buyer, L/C, bank and destination practice may add requirements. XLSX/PDF layout must be printable and stable.

**Required inputs:** invoice number/date/place; exporter legal identity/address/tax/contact; buyer/importer and consignee;
EORI/VAT where applicable; PO/contract; shipment; Incoterm 2020 plus named place; payment terms; line description,
SKU/style, confirmed HS/CN, origin, quantity/unit, unit price/value; currency; discounts/surcharges; conditional freight
and insurance; totals; transport/ports; linked packing/carrier/origin/customs references; approver and version.

**Implemented:** shipment profile/lines; parties with country/contact; invoice number/date/place; PO; Incoterm/location;
currency/payment; exporter tax; conditional freight/insurance; discount/surcharge; transport/ports; line values and totals;
style/size/colour/lot; explicit HS confirmation with reviewer/time and automatic invalidation when the HS code changes; PDF/XLSX;
no line cap; immutable issue and stale-snapshot block.

**Remaining:** destination-specific VAT/EORI and conditional consignee rules; HS classification source/ruleset/effective
date; booked/customs-value reconciliation beyond the calculated invoice total; optional signature rules;
staging review against one actual invoice and destination/buyer requirements.

**Definition of Done:** every required/conditional field is rule-tested; semantic XLSX/PDF tests verify labels and values;
totals and currency reconcile; no placeholder; shipment over 20 lines works; a trade operator manually signs off one
real VN-to-EU pilot; only then mark `READY_TO_ISSUE`.

### R02 — Packing List

**Applicability/format:** commonly required with invoice and transport documents; no single EU visual template.

**Required inputs:** packing-list number/date; exporter/consignee/transport references; invoice/shipment; package/container/
pallet/carton IDs and types; marks/numbers; exact item allocation; SKU/style/size/colour/lot when needed; quantity; per-unit
and total net/gross weight; dimensions/CBM; container/seal; total packages/quantity/net/gross/CBM; preparer/approver/version.

**Implemented:** dedicated number/date; transport reference; tenant-bound containers; container-pallet-carton hierarchy;
marks; dimensions; calculated row and document CBM; style/size/colour/lot; package contents allocation; package/quantity/
net/gross/CBM totals; PDF/XLSX; exact line allocation; gross >= net checks; net and gross line/package reconciliation;
two-container/two-pallet fixture with full and partial cartons.

**Remaining:** distinguish per-unit package weight/dimensions from grouped totals in the stored model; carrier/transport
company display; real warehouse pilot with a named reviewer.

**Definition of Done:** physical package ledger exactly reconciles quantity/net/gross/CBM to invoice and booking; final
partial package is represented correctly; over-20-line and multiple-container fixtures pass; real warehouse pilot passes.

### R03 — Carrier transport document and Carbon Annex

**Applicability/authority:** B/L/FBL, AWB, CMR or CIM depends on mode and must be issued/authenticated by the carrier or
authorised forwarder. WeaveCarbon must never issue a legal B/L.

**Required carrier metadata:** document type/number; issuer; issue/on-board date/place; shipper/consignee/notify party;
vessel/voyage/flight/vehicle; receipt/loading/discharge/delivery places; goods/packages/marks/gross/measurement;
container/seal; freight/payment terms; signature/authentication; original/negotiability status where applicable; file hash.

**Implemented:** shipment-linked upload, approval/current-validity gate, immutable evidence linkage and Carbon Annex XLSX
containing line carbon, carrier reference and container.

**Remaining:** structured carrier metadata/OCR confirmation; mode-specific validation; carrier totals reconciliation;
issuer/signature authenticity state; document replacement/version; Carbon Annex methodology/boundary/factor provenance.

**Definition of Done:** a real carrier document can be uploaded, approved and cross-checked without being altered; its
number/container/seal/packages/weights match Invoice and Packing List; Carbon Annex is clearly supplementary.

### R04 — Vietnam export declaration/VNACCS support

**Inputs:** declarant/exporter; customs office/procedure; invoice/contract/buyer; HS description quantity/unit/value/currency/
exchange rate/origin/destination; transport; packages/weights; permits/inspection; taxes; acceptance/MRN-like reference,
amendments and messages.

**Current gap:** only a text declaration reference is stored. No submission is authorised in this phase.

**Definition of Done:** versioned broker-handoff dataset passes an agreed schema, reconciles against R01/R02/R03, records
broker/authority response and never claims `AUTHORITY_ACCEPTED` without external evidence.

### R05 — EU import declaration/SAD/EUCDM support

**Inputs:** importer/declarant/representation/EORI; procedure; CN/TARIC; goods, quantities, packages, locations, origin;
transport; customs value/currency/Incoterm/freight/insurance; supporting document codes; MRN/status/amendments.

**Current gap:** no structured dataset. Import declaration is filed by the EU actor, not the Vietnamese exporter.

**Definition of Done:** destination/broker-specific handoff schema exists, reconciles to shipment documents, and external
status is evidence-backed. A generated handoff file must not be presented as an accepted customs declaration.

### R06 — ENS/ICS2 support dataset

**Inputs:** filing role; mode and ICS2 release/message type; master/house transport contract and consignment; parties/EORI;
routing/locations/conveyance; package/weight; detailed goods line, HS6+ and origin; supporting references; filing/message state.

**Implemented:** basic CSV with shipment/transport/container, consignor/consignee, importer EORI, loading/discharge and
per-line description/HS/origin/quantity/unit/gross weight; approved carrier evidence is required.

**Remaining:** official mode/release schema; master/house hierarchy; party identifiers/contact; transport equipment;
package-level and routing fields; code lists; XML/API/broker mapping; schema validation; rejection/amendment lifecycle.

**Definition of Done:** carrier/broker approves a test handoff and every CSV/XML field maps to the applicable ICS2 message;
different HS items are separate and no generic goods description passes. Submission is out of current scope.

### R07 — EVFTA proof of origin support

**Applicability:** only when preferential treatment is claimed. Origin cannot be inferred from factory address.

**Required inputs:** confirmed product HS/CN and product-specific rule; BOM with originating/non-originating material HS,
supplier, value/weight and evidence; processing; value-content calculation; cumulation/tolerance/insufficient processing;
non-alteration/direct-transport evidence; exporter authorisation where relevant; invoice/shipment; approval.

**Implemented:** Origin Workbook lists claimed origin lines and a preferential claim requires locked origin support.

**Remaining:** rules engine and version; BOM-origin ledger/calculation; supplier declarations; EUR.1 official boxes and
authority endorsement flow; exact Annex VI declaration wording and eligibility; revocation/amendment.

**Definition of Done:** a customs/origin specialist validates a real BOM against the effective EVFTA rule; the system blocks
an unsupported claim; output is explicitly draft until the exporter/authority performs the legally required action.

### R08 — EU textile fibre label

**Required inputs:** product components; allowed fibre names and mass percentages; ordering/rounding; animal-origin flag;
market languages; manufacturer/economic operator; placement/attachment and online-sale representation; version.

**Current:** generic composition exists, but there is no controlled legal vocabulary, component logic, locale pack or label.

**Definition of Done:** rules reject invalid fibre names/percentages; component and animal-origin rules pass; print and
online preview are generated for the destination language; compliance reviewer signs off representative products.

### R09 — EU footwear material label

**Required inputs:** upper, lining-and-sock and outer-sole components; area/volume material shares; 80% rule; two-main-
materials fallback; official pictograms or destination text; placement and version.

**Current:** no suitable model or generator.

**Definition of Done:** component model and 80% engine are tested at boundaries, pictogram/text artifacts render correctly,
and a footwear specialist approves physical/online samples.

### R10 — GPSR technical file and traceability

**Required inputs:** model/batch/serial identity; manufacturer/importer/EU responsible operator and contacts; risk analysis;
intended use/misuse/hazards/vulnerable users; standards/tests; warnings/instructions/languages; supply-chain traceability;
complaints/incidents/corrective action/recall; retention/version.

**Current:** only partial identity, passport and evidence primitives.

**Definition of Done:** complete product-specific technical file, EU operator validation, translated safety content,
test-report links and post-market workflow; tenanted access and retention tests pass.

### R11 — REACH/SVHC dossier

**Required inputs:** product/component/material/substance; CAS/EC/ECHA IDs; concentration/unit/location; Candidate List and
Annex XVII version/date; supplier declaration/SDS/lab method/result/detection limit; safe-use information; decision,
reviewer and consumer/authority response workflow.

**Current:** generic evidence records and static requirement labels only.

**Definition of Done:** versioned chemical rules evaluate thresholds and restrictions, source evidence is immutable, and
safe-use/response documents are generated and approved. Do not market a generic “REACH certificate”.

### R12 — Product Carbon Footprint / ISO 14067 support

**Required inputs:** report identity/responsibility; product and functional unit/reference flow; goal/intended use; period;
boundary/process map; exclusions/cut-offs; PCR; raw activity data and evidence; emission factor provenance/version/unit/
geography/year/GWP; allocation/recycling; data quality; uncertainty/sensitivity; stage results; fossil/biogenic/removal/LUC;
engine/hash/change log; assurance statement when applicable.

**Current:** server-authoritative partial PCF with stage totals, factor registry/version/hash, proxy/confidence indicators and
PDF/XLSX. It is explicitly pre-audit and not independently verified.

**Remaining:** functional-unit workflow, study period, process completeness, PCR, allocation/recycling, formal DQ, qualitative
uncertainty, LUC method, evidence binding and assurance workflow.

**Definition of Done:** calculation is reproducible from stored AD x EF, methodology/conformance checklist passes, claim
scope is accurate, and verification language is impossible unless an actual assurance record is linked.

### R13 — Corporate/facility GHG report

**Required inputs:** organisation/consolidation and operational boundary; facilities; period; Scope 1/2 separated and gases;
base year/recalculation; biogenic emissions; all relevant source types; methods/factors/GWP; exclusions; Scope 3 category
coverage where claimed; assurance.

**Current:** electricity and fuel emissions worksheet only.

**Definition of Done:** boundary/source completeness and base-year logic exist; missing sources/exclusions are disclosed;
all totals reproduce from evidence; report name accurately reflects its scope.

### R14 — Audit/evidence pack — P0 containment complete, implementation incomplete

**Required inputs/output:** signed assertion/criteria; data-management plan; roles/controls/retention; process map; calculation
manifest; raw activity data + unit/period/source; factor provenance/version/geography/unit; immutable evidence files/hashes;
QA/QC, approvals/exceptions; assumptions/allocation/uncertainty/change history; assurance record.

**P0 containment implemented:**

- Production no longer falls back to `DEMO_PACK_V2` or sample EVN/material evidence; demo preview requires an explicit flag.
- Aggregate stage CO2e is no longer represented as fake `activity × factor 1`; production download is blocked until raw
  contribution rows are supplied.
- Client JSON now states `locked: false`, `immutable: false`, `assuranceStatus: not_verified`.
- Base64 query text is no longer presented as an HMAC-verified share token.
- Only locked/third-party-verified, unexpired, stored evidence with a real file size and 64-character SHA-256 is displayed.
- UI and report copy no longer claim ISO certification, independent verifier approval or a working signed share link.

**Contribution-term increment implemented:**

- New server calculations emit `carbon-contribution-terms-v1` rows for materials, accessories, packaging, manufacturing
  energy and transport, with activity/unit, factor identity/version/value/unit/source/year/geography, GWP/boundary/proxy
  metadata, exact kg CO2e and allocation assumptions.
- The complete result is canonicalised into the existing immutable product assessment snapshot; a persistence test verifies
  contribution terms survive the authoritative create flow.
- Frontend response normalisation preserves the terms and rejects rows missing factor identity/version or units.
- The production Audit Pack reads only these authoritative rows. It does not permit caller-supplied or demo rows, and its
  CSV schema carries factor provenance and allocation metadata.
- Existing snapshots created before this change do not contain contribution terms. They remain blocked and must be
  recalculated to create a new snapshot; no legacy term is fabricated.

**Immutable-bundle increment implemented:**

- Migration 019 adds tenant-scoped, versioned `audit_bundles` and pinned `audit_bundle_evidence` records. Database triggers
  prevent mutation/deletion of completed bundles and prevent adding, changing or removing their pinned evidence rows.
- `POST /api/reports/v2/audit-packs` selects the tenant's latest authoritative calculation and only current locked or
  third-party-verified product evidence with a stored file, positive size and real SHA-256.
- The existing durable report worker creates a deterministic ZIP containing `manifest.json`, `calculation.json`, an
  evidence index and the exact evidence bytes. It verifies evidence hashes/sizes before completion and records both
  manifest and bundle SHA-256 values.
- `GET /api/reports/v2/audit-packs/:id` is company-scoped. Download rechecks stored bundle size and SHA-256 before streaming.
- The frontend creates, polls and downloads only the server bundle. Browser-generated production JSON/CSV was removed.
- Output remains explicitly `internal_review` and `not_verified`; this is not an assurance statement or authority filing.

**Evidence-review increment implemented:**

- Every calculation term now receives a deterministic term key and an immutable coverage row in the ZIP manifest. Activity
  evidence must declare the exact one-based calculation-row number, match an allowed stage-specific document type and carry
  a valid reporting-period range. Factor evidence must declare the exact `factorVersionId` and a reporting period.
- Evidence upload can be assigned to a real product and can record the calculation-row numbers and factor-version IDs it
  supports. These user-declared audit claims are preserved when later OCR results are merged; they are never inferred from
  document presence alone.
- Migration 020 adds tenant-bound, append-only human review and internal issuance records. Issuance is blocked unless the
  immutable bundle is complete, every term is covered, the latest review approves it, no blocking QA exception remains and
  no newer bundle supersedes it. Issuance does not change `assuranceStatus: not_verified`.
- The Audit UI shows row numbers, per-row evidence gaps, latest lifecycle state and separate review/internal-issue controls.
  A completed ZIP remains downloadable for internal review even when issuance is blocked.

**Isolated-pilot increment implemented:**

- CI now applies migrations 019/020 to disposable PostgreSQL and runs a guarded end-to-end pilot using synthetic data.
- The pilot calculates a multi-stage product, persists the authoritative snapshot, creates period-bound activity/factor
  evidence, builds and reopens two ZIP versions, rehashes every file, proves tenant isolation and database immutability,
  exercises an unresolved QA blocker, review, internal issue and version supersession.
- An issued bundle is no longer marked `superseded` merely because a newer draft exists. Supersession starts only after the
  replacement version is issued; an older unissued version cannot be issued once a newer completed version exists.
- The machine-readable result is uploaded as a CI artifact. See `docs/AUDIT_PACK_PILOT_RUNBOOK.md` for safety guards,
  execution and interpretation.

**Remaining:** run the same migrations and one real-evidence pilot on a confirmed non-production staging environment, then
record its ZIP checksum and human reviewer decision; add an actually signed assertion and expiring read-only share link; add
an external-assurance record/actor workflow. Structured QA exceptions are supported by the API but still need a dedicated
multi-row frontend editor. No external assurance or legal usability is claimed.

**Definition of Done:** production fails closed without a real product/calculation/evidence; no sample fallback; raw AD x EF
and units are preserved; lock/approval comes from backend state; server stores a checksummed manifest and evidence bundle;
missing evidence and assurance are visibly disclosed. This is the next P0 after R01/R02 staging review.

### R15 — Apparel & Footwear PEF/PEFCR

**Required inputs:** PEFCR functional unit/reference flow; full lifecycle; EF-compliant LCI and Data Needs Matrix; data quality;
all required impact categories and weighting; scenarios, allocation, use/end-of-life, supply-chain provenance; validation.

**Current:** climate-only partial PCF, which must not be called PEF-compliant.

**Definition of Done:** applicable PEFCR version is implemented end-to-end with compliant datasets and required independent
validation for external communication.

### R16 — ESPR Digital Product Passport

**Baseline architecture:** persistent product identifier; compliant data carrier; product/model/batch/item granularity;
structured/open/interoperable data; operator/facility/importer/responsible-person IDs; role-based access; updater/version/
revocation; retention; independent backup/service provider; registry event and customs identifier where required.

**Current:** prototype with valid-GTIN/public-HTTPS/operator/facility guards. It is not a final legal textile/footwear DPP.

**Definition of Done:** do not finalise product fields before the applicable delegated act. Build/test generic identity,
interoperability, access, integrity, backup, version and registry interfaces; add product fields only from the effective act.

### R17 — Textile/footwear EPR

**Required baseline:** producer identity/tax/trade IDs; Member State; product/CN group; authorised representative and PRO;
registration/status; quantities placed on market; fee/modulation; collection/treatment reporting; evidence/version.

**Current:** static requirement label only; national implementation varies/evolves.

**Definition of Done:** country-versioned rule set and registrations exist; market quantities reconcile to sales/shipments;
external registration/payment/submission status is backed by authority/PRO evidence.

### R18 — Green-claim substantiation dossier

**Required inputs:** exact claim text/channel/market/language/effective period; product and claim scope; baseline/comparison;
method/PCR/standard; datasets/factor/calculation hash; evidence/assurance; limitations/exclusions/uncertainty/qualifiers;
legal approval; update/withdrawal trigger.

**Current:** carbon reports exist, but there is no claim register or claim-to-evidence approval control.

**Definition of Done:** every public claim resolves to an approved, current dossier; prohibited/unqualified claims are blocked;
expired or changed evidence automatically returns the claim to review.

### R19 — CBAM applicability and reports

**Baseline decision:** standard apparel CN 61/62 and footwear CN 64 are outside current CBAM scope. Current CBAM sectors are
cement, iron/steel, aluminium, fertilisers, electricity and hydrogen, subject to the exact Annex-I CN list and thresholds.

**Implemented:** version-labelled prefix screening and `CBAM_NOT_APPLICABLE`; production page is a scope check; legacy
CBAM-style workbook remains demo-only.

**Remaining:** use an exact versioned CN/TARIC table rather than broad prefixes; reviewer/override evidence; threshold and
importer role logic; only for in-scope goods, official installation/operator/monitoring/process/source-stream/precursor/
direct-indirect/free-allocation/carbon-price/verification fields and Registry handoff.

**Definition of Done:** baseline textile/footwear cannot generate a CBAM declaration; an Annex-I fixture opens the correct
rules and official fields; output is never called an annual declaration unless filed by an authorised EU declarant.

### R20 — Specialist permits/certificates

**Applicability inputs:** effective date, origin, destination Member State, exact HS/CN/TARIC, materials, intended use,
consumer group, importer role, channel, shipment value and mode. Possible triggers include CITES/animal origin, PPE,
children's products, biocidal treatment, chemical controls, packaging/waste, sanctions or safety standards.

**Current:** static checklist cannot determine legal applicability.

**Definition of Done:** source-versioned rules return explainable applicable/not-applicable decisions and required evidence;
specialist reviewer approves high-risk classifications. Never claim the list is universally complete.

## 7. Implementation order

1. **Pilot R01 Commercial Invoice and R02 Packing List together** because they share shipment truth and reconciliation.
2. **Fix R14 Audit/evidence pack P0** before any assurance or “audit-ready” claim remains accessible in production.
3. **Complete R03 carrier ingestion/Carbon Annex**, then R06 ICS2 support because they share transport truth.
4. **Complete R07 origin**, including BOM/rules/evidence, before generating EUR.1/origin-declaration drafts.
5. **Complete active product obligations:** R08 textile label, R09 footwear label, R10 GPSR and R11 REACH.
6. **Raise carbon assurance maturity:** R12 PCF and R13 corporate/facility GHG; implement R15 only when commercially needed.
7. **Build future/conditional foundations:** R16 DPP, R17 EPR and R18 claims without pretending future schemas are final.
8. **Maintain R19 scope screening**; do not build CBAM filing for the baseline goods.
9. **Add R04/R05/R20 handoff workflows** when a customs broker and exact lanes provide accepted target schemas.

## 8. Required update protocol

For each report change, update this file with:

- Date and commit hash.
- Status before and after.
- Regulatory source/version/effective date used.
- Data model/API/UI/output changes.
- Automated tests and fixture names.
- Manual/staging evidence and reviewer.
- Remaining blockers and the exact next action.

Do not mark an item complete based only on unit tests. Attach or record the staging output checksum and reviewer decision.

## 9. Release and production gates

Before merging or deploying this branch:

1. Back up PostgreSQL and the uploads directory and verify restoration instructions.
2. Apply `migrations/017_shipment_export_workflow.sql`, `018_export_invoice_packing_details.sql`,
   `019_immutable_audit_bundles.sql` and `020_audit_bundle_review_lifecycle.sql` to staging cloned from a safe schema/data
   fixture.
3. Run migration rollback/forward compatibility checks appropriate to the environment.
4. Create one real-like Vietnam-to-EU shipment with more than 20 lines and multiple/partial packages.
5. Upload and approve a real-like carrier document; fill profile, package and carbon data without placeholders.
6. Generate/download/reopen/inspect/issue every applicable new document and verify MIME, size and SHA-256.
7. Reconcile invoice value/currency, quantity, packages, net/gross weight, B/L number, container and seal across files.
8. Verify tenant isolation, expired/unapproved evidence blocking, stale snapshot blocking and issued immutability.
9. Verify CN 61/62/64 yields `CBAM_NOT_APPLICABLE`; verify an Annex-I fixture triggers review without producing a fake filing.
10. Manually review document layout/meaning with an export operator/compliance owner.
11. Merge through reviewed pull requests. Observe CI, deploy health, migration logs, worker jobs and file downloads.

The report increment is deployed in production from `main`. The isolated loopback staging stack remains available for
synthetic pilots and must continue using its dedicated database and uploads volumes.

## 10. Verification commands

Backend:

```bash
npm test -- --runInBand
npm run verify
npm run test:migration-snapshots
npm run test:audit-bundle-pilot # isolated PostgreSQL only; see docs/AUDIT_PACK_PILOT_RUNBOOK.md
git diff --check
```

Frontend:

```bash
npm test -- --run
npm run check
npm run build
git diff --check
```

The migration snapshot command requires its documented PostgreSQL fixture. If it cannot run, record that as an open release
gate; do not substitute the production database.

## 11. Primary regulatory source register

Recheck these official sources at the start of the related report work and store a version/effective date in code:

- EU customs documents and procedures: https://trade.ec.europa.eu/access-to-markets/it/stories/documenti-e-procedure-di-sdoganamento
- ICS2: https://taxation-customs.ec.europa.eu/general-information-customs/customs-security/ics2_en
- EVFTA Protocol 1: https://trade.ec.europa.eu/access-to-markets/en/assets/VN_ENG_Protocol-1.pdf
- EU textile fibre names/labelling, Regulation (EU) 1007/2011: https://eur-lex.europa.eu/eli/reg/2011/1007/oj
- EU footwear labelling, Directive 94/11/EC: https://eur-lex.europa.eu/eli/dir/1994/11/oj
- GPSR, Regulation (EU) 2023/988: https://eur-lex.europa.eu/eli/reg/2023/988/oj
- REACH consolidated regulation: https://eur-lex.europa.eu/eli/reg/2006/1907
- ESPR/DPP framework, Regulation (EU) 2024/1781: https://eur-lex.europa.eu/eli/reg/2024/1781/oj
- CBAM definitive regime: https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en
- CBAM legal text: https://eur-lex.europa.eu/eli/reg/2023/956
- GHG Protocol standards/guidance: https://ghgprotocol.org/standards-guidance
- ISO 14067 catalogue entry: https://www.iso.org/standard/71206.html

Official sources define legal requirements; this tracker is an engineering control document, not legal advice.

## 12. Source map

Backend core:

- `migrations/017_shipment_export_workflow.sql`
- `migrations/018_export_invoice_packing_details.sql`
- `migrations/019_immutable_audit_bundles.sql`
- `src/services/exportShipmentService.js`
- `src/routes/exportV2.js`
- `src/utils/simpleXlsx.js`
- `src/modules/evidence/`
- `src/modules/reports/`
- `tests/services/exportShipmentService.test.js`
- `tests/config/exportWorkflowMigrationContract.test.js`
- `docs/EXPORT_WORKFLOW.md`

Frontend core:

- `components/dashboard/export/ShipmentExportPortal.tsx`
- `lib/weave-v2/shipmentExportApi.ts`
- `components/dashboard/export/ExportConfigurationPortalV2.tsx`
- `components/dashboard/cbam/CbamReportSection.tsx`
- `lib/cbam/applicability.ts`
- `components/audit/AuditPackClient.tsx`
- `lib/weave-v2/auditPackV2.ts`
- `lib/weave-v2/auditBundleApi.ts`
- `lib/reports/productCarbonTemplate.ts`
- `lib/reports/cbamTemplate.ts`
- `lib/carbon/types.ts`

Backend carbon trace core:

- `src/modules/carbon/core/engine.js`
- `src/modules/carbon/core/stages.js`
- `src/modules/carbon/calculationSnapshot.js`
- `tests/modules/carbon/core/calculationTerms.test.js`

## 13. Change log

### 2026-09-08 — Canonical tracker created

- Reconciled the earlier legal/source assessment with the feature-branch implementation.
- Corrected the programme status: the shipment export foundation is implemented, but the full 20-report programme is not.
- Identified R14 Audit/evidence pack as an unresolved production-safety issue.
- Recorded current branch hashes, tests, deployment state, report order and release gates.

### 2026-09-08 — R01/R02 completeness increment

- Status remains `READY_TO_PILOT`; this increment does not claim legal or production readiness.
- Added migration 018 for invoice place, packing-list identity/date, monetary adjustments, transport mode,
  style/size/colour/lot and auditable HS confirmation.
- Advanced the engineering ruleset to `VN-EU-TEXTILE-2026.09.1`; this is an internal validation version, not a legal
  certification or customs schema version.
- Added backend readiness gates, ISO country/currency and date/code-format checks, gross-weight and invoice-total checks,
  report-specific metadata/columns and CBM totals.
- Added frontend inputs for the same fields, party country/contact, HS confirmation and CBM preview.
- Added tests for migration additivity, SQL parameter binding, authenticated HS approval, approval invalidation after a code
  change, document blocking, totals/reconciliation and semantic XLSX labels.
- Automated checks passed locally: backend 90 suites/555 tests plus verify; frontend 36 files/161 tests plus check and
  production build. The legacy migration snapshot script could not validate this change because its required fixed
  `00000000-0000-4000-8000-000000000052` fixture is absent; staging migration remains open.
- Implementation commits: backend `32afddaeb088ffe2afab0af57bd0d238d849bd18`; frontend
  `4f51dc9e372fcbf31e8228174281d5efe53617b8`.
- Remaining gate: migration on staging, a >20-line multi-container/partial-carton fixture, PDF/print layout and operator
  review. No production deployment was performed.

### 2026-09-08 — Completed calculator side change

- Frontend commits `00ffb8d` and `13aeea6` added weighted multi-material composition (must total 100%), manual distance,
  transport mode and tonne-kilometre calculation with tests. This is not itself a compliant PCF or export report.

### 2026-09-08 — R14 production safety containment

- Status remains `PARTIAL`; the unsafe preview path was removed but the immutable server bundle is not implemented.
- Frontend commit `af54d39040edb2f514a4b86fad1fc05e36aab9f6` removes production demo/evidence fallback, fake
  `activity × 1`, unconditional lock state and browser-only token verification claims.
- Production export now fails closed without server-authoritative contribution rows and strictly eligible evidence.
- Frontend 37 files/165 tests, check and production build passed; 18 unrelated pre-existing lint warnings remain.
- Exact next action: add a tenant-scoped backend audit-bundle model/API backed by immutable calculation contribution terms
  and evidence file hashes, then connect the disabled production download buttons to that job.

### 2026-09-08 — R14 authoritative contribution terms

- Status remains `PARTIAL`; this increment completes the raw AD × EF preservation prerequisite but does not create an
  issued, assured or downloadable Audit Pack.
- Backend commit `715df83c9c082827ac9de26778b82b9e68cdd58e` records versioned contribution terms in every new authoritative
  calculation and immutable product assessment snapshot.
- Frontend commit `cf19cd5ce037d088c692e370ec1460e14c861543` normalises and displays only those server terms, enriches the internal
  CSV schema, and keeps production downloads disabled pending a server-created immutable bundle.
- Automated checks passed locally: backend 91 suites/561 tests plus verify; frontend 37 files/165 tests plus check,
  typecheck and production build. The 18 frontend lint warnings are pre-existing and unrelated to this increment.
- Existing snapshots require recalculation to obtain `carbon-contribution-terms-v1`; they fail closed rather than receiving
  reconstructed or placeholder rows.
- Exact next action: add the tenant-scoped audit bundle tables/API/job, bind approved evidence hashes to its manifest, then
  verify immutability, tenant isolation, download checksum/MIME and issue/supersede behavior.

### 2026-09-09 — R14 immutable server bundle

- Status remains `PARTIAL`: a downloadable internal-review pack now exists, but term-to-evidence mapping, human approval,
  issue/supersede state, signed sharing and independent assurance are not complete.
- Backend commit `f973ab101fa5fbf5149bc4a006405606218be198` adds migration 019, tenant-scoped APIs, existing-queue worker
  integration, deterministic ZIP generation, manifest/bundle SHA-256 and download-time integrity verification.
- Frontend commit `aeb19e31023b48dfcc4f5644e2a1119ad77ecdf4` replaces client-generated production downloads with create/poll/download
  of the server ZIP and shows the immutable bundle checksum without claiming verification.
- Automated checks passed locally: backend 93 suites/572 tests plus verify; frontend 38 files/166 tests plus check,
  OpenAPI contract sync, typecheck and production build. The 18 frontend lint warnings remain pre-existing.
- The legacy migration snapshot command still reports its missing legacy fixture and therefore does not prove migration 019
  on a real database. No production database or upload directory was mutated.
- A read-only VPS inspection on `obk-vm-ext-1` confirmed both production checkouts are clean on `main`, the FE/BE
  containers are healthy, and neither the host checkouts nor running images contain the R14 bundle modules. Remote
  `feat/shipment-export-workflow` points to backend tracker commit `a54cd9a695d4175ea0b124760bbe48caa5b7ed86`
  and frontend commit `aeb19e31023b48dfcc4f5644e2a1119ad77ecdf4`; pushing the feature branch did not affect production.
- Exact next action: apply migration 019 to staging, create a recalculated product with locked evidence, download/open/check
  its ZIP, then implement term-to-evidence mapping and reviewer issue/supersede controls.

### 2026-09-09 — R14 explicit evidence coverage and internal review lifecycle

- Status remains `PARTIAL`. Backend commit `acec186b82ea7ff8691298e16af7c76793ddc6c7` adds migration 020, deterministic term-to-evidence coverage, explicit
  activity-row and factor-version claims, reporting-period gates, append-only human reviews, blocking QA exceptions and an
  internal issue/supersede lifecycle. Tenant identity is enforced both in service queries and composite foreign keys.
- Frontend commit `56f2bf07afa3f455473502808d324e85411ca890` adds product-scoped evidence upload metadata, displays calculation row numbers and exact gaps,
  and exposes review/internal-issue controls without changing the `not_verified` assurance label.
- Automated checks passed locally: backend verify plus 94 suites/580 tests; frontend check plus 38 files/167 tests and a
  production build. The 18 frontend lint warnings remain pre-existing and unrelated to this increment.
- Migrations 019/020 are still unproven against a fixed legacy staging fixture. Production remains healthy on old `main` and
  was not migrated, restarted or otherwise mutated.
- Exact next action: run both migrations on staging with backup/restore evidence, complete one real product through the new
  evidence matrix and manual ZIP review, then implement signed assertion/share delivery and external-assurance records.

### 2026-09-09 — R14 guarded PostgreSQL lifecycle pilot

- Status remains `PARTIAL`: the automated technical lifecycle now has a real-database gate, but no human real-evidence
  staging review, signed share delivery or independent assurance has occurred.
- Backend commit `e2c03ad50e0ff9856d9c64cd4843bc175b0080d3` adds the guarded pilot, its runbook and CI artifact. It validates contribution-term
  coverage, exact ZIP contents/checksums, issue gates, append-only records, tenant isolation and two-version supersession.
- Supersession semantics were corrected: a newer draft cannot invalidate an issued bundle; the older bundle becomes
  `superseded` only when the replacement is issued. A newer completed version blocks issuance of the older unissued pack.
- Local syntax, lint and unit checks can run without PostgreSQL. The end-to-end pilot is wired to CI's disposable PostgreSQL
  service because Docker Desktop and a local PostgreSQL client are unavailable on this workstation. CI run
  `34289284974` passed all jobs, including migrations, the Audit Pack pilot, restore drill and API integration; its
  `audit-pack-pilot-34289284974` artifact is retained for 14 days.
- Production was not accessed, migrated, restarted or deployed during this increment.
- Exact next action: obtain/confirm a non-production staging database, run the guarded pilot and migration/restore gates,
  then complete one real-evidence human review and record reviewer plus bundle checksum here.

### 2026-09-09 — Isolated VPS staging and guarded R01/R02 pilot

- Frontend commit `188fe3d` adds a separate `weavecarbon-staging` Compose project. It uses dedicated PostgreSQL/uploads
  volumes and internal application/data networks; only its proxy joins an ingress bridge and binds to
  `127.0.0.1:18080`. Production ports, containers, volumes, checkouts and database were not reused.
- Backend commit `ce4873e` prevents deployed staging from loading the development-only `pino-pretty` package. Backend
  commit `dab966c` fixes a real integration defect where PostgreSQL `DATE` objects were rejected by the ISO-date validator.
- The staging database loaded the base schema and every migration through 020. DB, BE and FE health checks passed;
  staging `/ready` and `/` returned HTTP 200. `https://weavecarbon.com/` also returned HTTP 200 after the work, and both
  production checkouts remained clean on `main`.
- The guarded R14 pilot passed on database `weavecarbon_staging`, including ZIP/checksum verification, exact evidence
  coverage, tenant isolation, append-only review/issuance, immutability and two-version supersession. Its assurance status
  remains `not_verified`; this is not external assurance.
- Backend commit `002aea9` adds the guarded R01/R02 pilot and runbook. The staging run created 25 CN 61/62/64 lines and
  50 cartons (25 full plus 25 partial), reconciled quantity/net/gross weight, returned `CBAM_NOT_APPLICABLE`, generated,
  issued and reopened both XLSX files, and verified MIME, size, hash, tenant isolation, issued immutability and stale-snapshot blocking.
- Commercial Invoice staging artifact SHA-256:
  `d0f9e0dab8d852e1a3fddeee0af80cace69f1b2fb374bff3a5052f281def5ae7`.
- Packing List staging artifact SHA-256:
  `ab4af3d6b622816a28f342fc99256873e35ea94fee0b99c47a03262504b60653`.
- R01 and R02 remain `READY_TO_PILOT`, not `READY_TO_ISSUE`: no export operator/warehouse reviewer has approved the
  synthetic layout, PDF/print output is absent, and the current package model cannot represent a true multi-container
  container-pallet-carton hierarchy.
- Exact next action: add additive container/package hierarchy and stable PDF/print renderers for R01/R02, rerun the fixture
  with at least two containers, then obtain named human export-operator and warehouse decisions on representative files.

### 2026-09-09 — Main merge, production backup and deployment verification

- The backend report increment was fast-forwarded to `main` at
  `a242a80e8755688246ccc0c1676c6874c8b9f8e6`. Main CI run `34292449082` and deploy run `34292502356` completed
  successfully. The backend startup log applied migrations 019/020 and then confirmed the schema was current through 020.
- The frontend report increment was fast-forwarded to `main` at
  `188fe3d9ebf7afc77caab3e67a14c09b3f1fadd9`. Main CI run `34292712417` and deploy run `34292802240` completed
  successfully.
- Before the merge, production PostgreSQL and uploads were backed up under
  `/opt/weavecarbon/backups/pre-main-merge-20260909`. `postgres.dump` SHA-256 is
  `7c7382495b925ad9879433606738eb004d396d9ec780d5f62b2118fecbf67f4e`; `uploads.tar.gz` SHA-256 is
  `0b7a6242f9a8dd7067e600e49909376612b426bd4b1392a87dc953145849f666`. A temporary PostgreSQL 16 restore drill
  succeeded with 66 public tables; the temporary restore container and volume were removed after verification.
- Post-deploy verification found both production checkouts clean on `main` at the exact merge commits, production DB/BE/FE,
  proxy and RAG containers healthy, `/health` healthy and `https://weavecarbon.com/` returning HTTP 200. The isolated
  staging containers remained healthy and separate.
- Production availability does not promote any report's business/legal status. R01/R02 remain `READY_TO_PILOT`, R14
  remains `PARTIAL`, and no report is confirmed `READY_TO_ISSUE` without the named human and output-format gates above.
- Exact next action remains the R01/R02 container/package hierarchy and stable PDF/print renderers, followed by a
  two-container pilot and named export-operator/warehouse review.

### 2026-09-09 — R01/R02 container hierarchy, PDF and two-container staging gate

- R01 and R02 remain `READY_TO_PILOT`, not `READY_TO_ISSUE`. This increment closes the planned technical PDF and
  package-hierarchy gaps; it does not replace the required named export-operator and warehouse approvals.
- Backend commit `9934423fac24b00ceca4ad65f11cec2e2f30a5c3` adds additive migration 021, tenant-bound containers,
  container-pallet-carton relationships, immutable output-format identity, PDF renderers and PDF/XLSX format selection.
  Frontend commit `bace2dc4f7d3929aebfd36431833c63f61e4e169` adds container/hierarchy editing and document-format selection.
- Local gates passed: backend verify plus 95 suites/590 tests; frontend check plus 38 files/167 tests and production build.
  Two three-page A4-landscape QA PDFs were rendered with Poppler, visually inspected page by page and text-checked for
  the last of 25 product lines and page numbering.
- Before applying migration 021, isolated staging PostgreSQL and uploads were backed up under
  `/opt/weavecarbon-staging/backups/pre-021-20260909`. Database SHA-256 is
  `aa44046638ce79ffa62afaadac8a59649419420fd2586d9f5c8627fcc32285f3`; uploads SHA-256 is
  `d0120ac4e2584d07a6763317d31818716e7d370f44c3bfc9fa41187cb58b66ba`. A PostgreSQL 16 restore drill succeeded
  with 70 public tables and its temporary container/volume were removed.
- Staging applied `021_export_container_hierarchy_pdf.sql`; DB, BE and FE became healthy and `/ready` plus `/` passed.
  The guarded pilot created 25 lines, two containers, two pallets and 50 cartons, including 25 partial cartons. It issued
  and reopened four files, verified readiness/reconciliation, MIME/size/SHA-256, tenant isolation, issued immutability and
  stale-snapshot blocking. Ordinary CN 61/62/64 correctly returned `CBAM_NOT_APPLICABLE`.
- Staging issued-file SHA-256 values: Commercial Invoice XLSX
  `618444737b5534024e856725bd7fcabb36790640ffd6dedfd5db9e0c0d638433a`; Commercial Invoice PDF
  `2bd24ccc3160a162385bbd98aa2bd29281838de52cd09de97fb42e9271b52c113`; Packing List XLSX
  `f96a8da09ad55ec978f424786ec72469e9854cdcf1407fd247d5c6e1584bbc55a`; Packing List PDF
  `1450b9bc7cdcf9ec701ec321eb3f40ae272788964eb77602ecb3376a4cf187aaf`.
- Exact next gate for R01: named operator review against a real invoice plus buyer/destination VAT/EORI, consignee, HS
  source and customs-value requirements. Exact next gate for R02: make grouped package weight/dimension semantics explicit,
  add carrier display and obtain a named warehouse review of a representative physical pack.

### 2026-09-09 — Migration 021 production rollout, restore drill and frontend security patch

- Backend `main` at `4ff6bc8973733225dcca3ea76f33d5a276438994` passed CI run `34355681111` and deploy run
  `34355750698`. Production startup applied `021_export_container_hierarchy_pdf.sql`; the production backend checkout,
  container health and migration record were verified after deployment.
- A fresh production-state backup was captured under `/opt/weavecarbon/FE/backups/state-20260909T130532Z` before the
  final frontend rollout. Database SHA-256 is `dbb69a221eb92e72c4c9012b7385bf3dcafcac58a6c67b09f19a746abf18ee3e`;
  uploads SHA-256 is `5e9942c65a71de04d7f110bec101478eda6344a3bfaeba6ca76549b151d6714b`.
- The backup was restored into an isolated PostgreSQL/uploads/application stack. The signed report at
  `/opt/weavecarbon/FE/restore-drills/weavecarbon_restore_20260909_131028/restore-report.txt` records `PASS`, an RPO of
  294 seconds and an RTO of 19 seconds after dump integrity, table counts, upload archives, authentication, dashboard,
  product, evidence, RAG and frontend checks. Temporary restore resources were removed after verification.
- The first frontend deploy run `34356345599` correctly failed before contacting the VPS because its immutable image still
  contained two CRITICAL Next.js findings. Commit `6016c07605e3cab56cd5c40c02dbd46193b7f2b3` updates Next.js to 16.3.3,
  MapLibre GL to 6.9.0 and refreshes the dependency lock. Local audit, 38 test files/167 tests, check and production build
  passed; the rebuilt staging image then passed the exact Trivy CRITICAL gate with zero findings and returned HTTP 200.
- Frontend CI run `34360023924` and deploy run `34360167542` completed successfully for the exact patched commit. Final
  production verification found frontend `6016c07605e3cab56cd5c40c02dbd46193b7f2b3` and backend
  `4ff6bc8973733225dcca3ea76f33d5a276438994` on `main`; production DB, BE, FE and RAG containers were healthy,
  migration 021 was present, `/health` was healthy and the public site returned HTTP 200.
- These technical and deployment gates do not promote legal/business readiness. R01 and R02 remain `READY_TO_PILOT` until
  the named export operator and warehouse reviewers approve representative real shipment files against the open gates above.
