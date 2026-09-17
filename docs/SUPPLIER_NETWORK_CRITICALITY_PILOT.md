# Supplier Network and Carbon-Climate Criticality Pilot

Baseline date: 2026-09-18  
Vision source: `WeaveCarbon Mới cập nhật 12.09.docx`  
Implementation phase: G2-11

## Truth boundary

This capability is a governed prioritisation workflow, not an automatic physical-risk forecast, supplier rating, assurance opinion or complete supply-chain inventory. Carbon, climate and business-dependency components are normalized by an authorised user under a documented model. Every snapshot remains `needs_specialist_review` until external acceptance evidence exists.

Portfolio coverage describes only the immutable subjects explicitly selected for that portfolio. It must not be presented as a percentage of all suppliers, spend or production unless the pilot independently proves the denominator.

## Governed records

- Supplier profiles, supplier sites and procurement relationships are tenant-bound, append-only revisions backed by locked or third-party-verified evidence.
- Business dependency preserves spend percentage, production-dependency percentage, single-source status, dependent SKU count and dependent route count as separate facts.
- Supplier climate assessments preserve site location evidence, source URL, dataset identifier/version, spatial and temporal resolution, grid reference, scenario/horizon, uncertainty and author rationale.
- Carbon inputs are immutable facility or supplier snapshots with an explicit reporting period, boundary, methodology, source kind, data-quality level and evidence checksum.
- Criticality models preserve approved carbon, climate and dependency weights that total exactly 100%, priority thresholds, normalization policy, rationale and evidence.

## Deterministic calculation

For normalized component scores from 0 to 100:

`weighted_score = (carbon_score × carbon_weight + climate_score × climate_weight + dependency_score × dependency_weight) / 100`

The service derives the priority band from the approved model thresholds. It snapshots the exact model revision, carbon record, comparable climate records, dependency facts, user rationales and resulting score before hashing the input. A supplier portfolio accepts only unique subjects that share one model revision and assessment period.

Climate inputs must contain one to three distinct hazards from `heat`, `drought` and `extreme_rainfall`. Inputs must refer to the same subject, scenario, horizon and projection model where applicable, and their current evidence checksums must still match the stored snapshots.

## Pilot procedure

1. Select named facilities and suppliers and define the coverage denominator outside the application.
2. Lock identity, site, procurement, carbon and climate-source evidence.
3. Record supplier relationships without combining dependency indicators into one hidden score.
4. Create climate assessments using a licensed/versioned dataset extract and document spatial matching and uncertainty.
5. Approve one normalization and weighting model with named ownership and evidence.
6. Create criticality snapshots and independently reproduce their weighted scores and priority bands.
7. Create a portfolio and reconcile selected subject count, hazard completeness, supplier-specific carbon count, dependency coverage, single-source count and selected supplier spend.
8. Obtain climate-specialist and procurement-owner review; record corrections as new immutable revisions.

## External acceptance still required

- Real supplier and facility sample with consent and documented coverage denominator.
- Licensed ERA5-Land/CMIP6 or other approved data extraction with reproducible source artifacts.
- Climate-specialist approval of hazard metrics, normalization bands, scenarios, spatial matching and uncertainty language.
- Procurement-owner approval of dependency evidence and single-source interpretation.
- Independent score reproduction and tenant-isolation testing.
- Evidence that the same supplier data is reused consistently for Scope 3, buyer requests, PCF and traceability workflows.

Until these gates pass, G2-11 is an implemented software baseline only.
