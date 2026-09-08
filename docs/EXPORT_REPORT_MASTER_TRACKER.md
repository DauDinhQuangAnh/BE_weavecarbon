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
| Working branch in both repositories | `feat/shipment-export-workflow` |
| Backend R01/R02 implementation commit | `32afddaeb088ffe2afab0af57bd0d238d849bd18` |
| Frontend R01/R02 implementation commit | `4f51dc9e372fcbf31e8228174281d5efe53617b8` |
| Frontend R14 safety commit | `af54d39040edb2f514a4b86fad1fc05e36aab9f6` |
| Production site | `https://weavecarbon.com` |
| Production state at 2026-09-08 | Healthy on the old `main`; the feature branch is not deployed |
| Production deploy behavior | A successful `main` pipeline deploys; backend startup runs migrations |

Never put server passwords, database credentials, tokens or `.env` values in this file.

### Restore context on another machine

```bash
git clone https://github.com/DauDinhQuangAnh/BE_weavecarbon.git
git -C BE_weavecarbon switch feat/shipment-export-workflow
git clone https://github.com/DauDinhQuangAnh/weavecarbon.git
git -C weavecarbon switch feat/shipment-export-workflow
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

## 4. What the feature branch actually completed

The current feature branch completed the shared shipment-document foundation, not the entire report programme:

- Shipment-scoped export profile, immutable line snapshot and package records.
- Versioned export documents and requirement results.
- Lifecycle support for draft/review, blocked, issued and superseded documents.
- Commercial Invoice, Packing List, Carbon Annex and Origin Workbook XLSX generation.
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

Known overall checks at the baseline commits:

- Backend: 89/89 suites and 534/534 tests passed; `npm run verify` passed.
- Frontend: 34/34 files and 156/156 tests passed; `npm run check` and production build passed.
- Migration snapshot integration test was not executed because the legacy database fixture, Docker daemon and local
  PostgreSQL client were unavailable. Static migration contract tests passed. Staging migration remains mandatory.

## 5. Master dossier matrix

| # | Report/document | Applicability | Current status | Current capability | Next gate |
|---:|---|---|---|---|---|
| 1 | Commercial Invoice | Almost every sale shipment | `READY_TO_PILOT` | Shipment XLSX, invoice identity/place, party/contact, HS confirmation, adjustments and immutable issue | PDF/print form and staging operator review |
| 2 | Packing List | Normal customs/transport practice | `READY_TO_PILOT` | Dedicated identity/date, package XLSX, CBM and quantity/net/gross reconciliation | Package hierarchy and staging physical-pack test |
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
| 14 | Audit/evidence pack | Buyer or verifier dependent | `PARTIAL` | Production fails closed; demo/evidence/fake-lock risks contained | Preserve raw AD x EF and build immutable server evidence bundle |
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
style/size/colour/lot; explicit HS confirmation with reviewer/time and automatic invalidation when the HS code changes; XLSX;
no line cap; immutable issue and stale-snapshot block.

**Remaining:** destination-specific VAT/EORI and conditional consignee rules; HS classification source/ruleset/effective
date; PDF/print form; booked/customs-value reconciliation beyond the calculated invoice total; optional signature rules;
staging review against one actual invoice and destination/buyer requirements.

**Definition of Done:** every required/conditional field is rule-tested; semantic XLSX/PDF tests verify labels and values;
totals and currency reconcile; no placeholder; shipment over 20 lines works; a trade operator manually signs off one
real VN-to-EU pilot; only then mark `READY_TO_ISSUE`.

### R02 — Packing List

**Applicability/format:** commonly required with invoice and transport documents; no single EU visual template.

**Required inputs:** packing-list number/date; exporter/consignee/transport references; invoice/shipment; package/container/
pallet/carton IDs and types; marks/numbers; exact item allocation; SKU/style/size/colour/lot when needed; quantity; per-unit
and total net/gross weight; dimensions/CBM; container/seal; total packages/quantity/net/gross/CBM; preparer/approver/version.

**Implemented:** dedicated number/date; transport reference; flat packages; marks; dimensions; calculated row and document
CBM; style/size/colour/lot; package contents allocation; package/quantity/net/gross/CBM totals; XLSX; exact line allocation;
gross >= net checks; net and gross line/package reconciliation.

**Remaining:** explicit container-pallet-carton hierarchy; distinguish per-unit package weight/dimensions from grouped
totals in the stored model; carrier/transport company display; PDF/print form; semantic test with a partially filled final
carton and a multi-container shipment; real warehouse pilot.

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

**Remaining:** expose immutable calculation contribution terms from the server (activity, activity unit, factor value/unit,
factor identity/version/source/geography/period/allocation); bind approved source files; create a server-side checksummed
manifest and downloadable bundle; add approval/issue/version lifecycle and an actually signed, expiring read-only link.

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
2. Apply `migrations/017_shipment_export_workflow.sql` and `018_export_invoice_packing_details.sql` to staging cloned from
   a safe schema/data fixture.
3. Run migration rollback/forward compatibility checks appropriate to the environment.
4. Create one real-like Vietnam-to-EU shipment with more than 20 lines and multiple/partial packages.
5. Upload and approve a real-like carrier document; fill profile, package and carbon data without placeholders.
6. Generate/download/reopen/inspect/issue every applicable new document and verify MIME, size and SHA-256.
7. Reconcile invoice value/currency, quantity, packages, net/gross weight, B/L number, container and seal across files.
8. Verify tenant isolation, expired/unapproved evidence blocking, stale snapshot blocking and issued immutability.
9. Verify CN 61/62/64 yields `CBAM_NOT_APPLICABLE`; verify an Annex-I fixture triggers review without producing a fake filing.
10. Manually review document layout/meaning with an export operator/compliance owner.
11. Merge through reviewed pull requests. Observe CI, deploy health, migration logs, worker jobs and file downloads.

The feature branch is not running on the production VPS at the time of this update.

## 10. Verification commands

Backend:

```bash
npm test -- --runInBand
npm run verify
npm run test:migration-snapshots
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
- `lib/reports/productCarbonTemplate.ts`
- `lib/reports/cbamTemplate.ts`

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
