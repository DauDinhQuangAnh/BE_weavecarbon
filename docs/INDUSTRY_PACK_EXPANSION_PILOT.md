# G2-12 Industry Pack Expansion Pilot

Baseline date: 2026-09-18  
Vision source: `WeaveCarbon Mới cập nhật 12.09.docx`

## Truth boundary

The seven manifests are governed software-pilot configurations. They do not constitute approved sector methodologies, default emission factors, regulatory filings, CBAM applicability decisions, certifications or independent verification. Every result remains `specialist_review_required` when it is computable.

Only approved non-proxy factor proposals with current locked evidence may be used. Activity and production evidence must be locked, non-empty and checksum-identified. The pilot accepts only a documented single-product 100% allocation; co-product and multi-level allocation must use the governed G2-08 allocation workflow and sector-expert review.

## Pack contract

| Pack | Process taxonomy | Required activity categories | Required sector context | Candidate target mappings |
|---|---|---|---|---|
| Steel | Raw material, coke, sinter, pellet, BF, BOF, EAF, rolling | Process, fuel, electricity | Existing G2-05 baseline | Domestic MRV; CBAM goods-scope check |
| Cement | Raw meal, kiln, clinker, grinding, additives | Process, fuel, electricity | Existing G2-05 baseline | Domestic MRV; CBAM goods-scope check |
| Textile/Apparel | Spinning, weaving, knitting, dyeing, finishing, garment | Material, fuel, electricity | Batch/SKU, material/BOM, buyer/product boundary | Buyer/PCF/Scope 3/traceability; domestic applicability check |
| Aluminium | Alumina, smelting, casting, recycled input, electricity | Material, process, electricity | Input-material basis, recycled-content %, electricity boundary | Facility/product carbon; CBAM goods-scope check |
| Construction Materials | Quarry, crushing, cutting, ceramics, glass, concrete, logistics | Material, fuel, electricity | Material type, quarry/plant, logistics boundary | Domestic resource tracking; buyer/product data |
| Fertiliser/Chemicals | Ammonia, nitric acid, urea, blending, chemical processing | Feedstock, process, steam, electricity | Product/intermediate, feedstock basis, process-emission basis | Domestic process emissions; CBAM goods-scope check |
| Mining/Minerals | Extraction, crushing, beneficiation, processing, logistics | Process, fuel, electricity, transport | Mineral/ore, extraction method, logistics boundary | Facility/resource intensity; upstream supplier evidence |

Target mappings are routing candidates only. CBAM applicability still depends on exact goods classification, jurisdiction, reporting period and current law.

## Acceptance procedure

1. Select one named facility, one bounded process/use case and one reporting period per pack.
2. Map the process revision to the manifest taxonomy and complete every required context field.
3. Lock production and activity evidence and approve non-proxy factor proposals with matching units and boundaries.
4. Run the deterministic fixture and independently reproduce every calculation line, gross total and intensity.
5. Reconcile the pilot result to the facility inventory and, when applicable, the governed allocation and export adapter.
6. Record findings from the facility owner and qualified sector/LCA expert as new immutable revisions.

## External proof still required

- A real-facility data sample and signed scope/boundary for each pack.
- Sector-expert approval of taxonomy, required fields, validation rules, factor boundaries and allocation treatment.
- Independent reproduction of calculation totals and evidence lineage.
- Domestic MRV and export/buyer reuse evidence where the target mapping is applicable.
- Performance, usability and rework metrics from the pilot workflow.

Until all relevant gates pass, G2-12 is an implemented software baseline only and the overall Industry Rules capability remains `partial`.
