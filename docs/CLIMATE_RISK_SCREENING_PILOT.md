# G2-07 Climate risk screening pilot

This is a governed, author-assigned screening register and portfolio prioritization view, not a validated physical-risk forecast, onsite sensor observation, insurance risk model or investment advice. Every assessment remains `needs_specialist_review`.

The 2026 WeaveCarbon vision document distinguishes hazard, exposure, vulnerability, business dependency and criticality. The pilot stores them separately. The underlying data must be supplied and checked by a human; the server does not download, interpolate, downscale or calculate ERA5-Land or CMIP6 fields.

## Workflow

1. Create a canonical facility revision. Lock a geolocation evidence document, then `POST /api/climate-risk/locations` with coordinates, positional precision, basis and evidence UUID. Location revisions are immutable.
2. Lock the source extract/methodology evidence. `POST /api/climate-risk/assessments` with the facility/location, one of heat/drought/extreme rainfall, historical or projection scenario, horizon, source identifier/version/URL, spatial and temporal resolution, grid-cell reference and spatial matching notes, hazard metric/value/unit, uncertainty, 1–5 exposure and vulnerability ratings, business dependency percent, author-assigned priority band and rationale. A projection also requires model and scenario names. Assessments are immutable and preserve the evidence checksum.
3. Select 2–100 assessment IDs for `POST /api/climate-risk/portfolios`. Each stable facility reference may use only one facility revision and one assessment per hazard. All selected assessments must share a source kind, scenario and horizon; projections must also share model and scenario. Each facility must have a consistent business-dependency percentage, and percentages across unique facilities must total exactly 100.000. The output counts facilities by their highest author-assigned priority band and sums dependency percentages by band. It flags facilities without all three hazards. No numeric physical-risk score is inferred.

All endpoints except reads require a company admin. All references and ledgers are tenant-bound and append-only; no public sharing or cross-company rollup is present.

## Data-source boundary

[Copernicus ERA5-Land](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land?tab=overview) is historical reanalysis, not an onsite sensor. [Copernicus CMIP6](https://cds.climate.copernicus.eu/datasets/projections-cmip6?tab=overview) contains model/experiment projections whose horizontal resolution varies by model. Consequently, the source, resolution, model/scenario and uncertainty are mandatory provenance fields rather than implicit guarantees of site-scale accuracy. A specialist must check grid-to-site applicability, hazard thresholds, model ensemble, bias correction, business-dependency assumptions and adaptation context before use in decisions.

## Acceptance still required

Integrate licensed/versioned dataset extraction; validate against a real facility and supplier sample; agree hazard metrics and thresholds with climate specialists; test geospatial matching and scenario comparability; validate the governed G2-11 carbon-climate-dependency overlay; document uncertainties and operational review. G2-07 remains partial until this evidence exists.
