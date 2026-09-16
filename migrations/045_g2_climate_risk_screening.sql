-- G2-07 evidence-bound climate-risk screening, not a physical-risk forecast.
-- All records are append-only and tenant-bound to canonical industrial facilities.

CREATE TABLE IF NOT EXISTS public.climate_risk_location_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  precision_meters INTEGER NOT NULL CHECK (precision_meters BETWEEN 1 AND 100000),
  location_basis TEXT NOT NULL CHECK (length(trim(location_basis)) BETWEEN 1 AND 2000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id), UNIQUE(id, company_id, facility_revision_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.climate_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  location_revision_id UUID NOT NULL,
  hazard_type TEXT NOT NULL CHECK (hazard_type IN ('heat', 'drought', 'extreme_rainfall')),
  scenario_kind TEXT NOT NULL CHECK (scenario_kind IN ('historical', 'projection')),
  scenario_reference TEXT NOT NULL CHECK (length(trim(scenario_reference)) BETWEEN 1 AND 120),
  horizon_start DATE NOT NULL,
  horizon_end DATE NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('ERA5_LAND', 'CMIP6', 'OTHER')),
  source_url TEXT NOT NULL CHECK (source_url ~* '^https://' AND length(source_url) <= 2000),
  dataset_identifier TEXT NOT NULL CHECK (length(trim(dataset_identifier)) BETWEEN 1 AND 240),
  dataset_version TEXT NOT NULL CHECK (length(trim(dataset_version)) BETWEEN 1 AND 120),
  spatial_resolution TEXT NOT NULL CHECK (length(trim(spatial_resolution)) BETWEEN 1 AND 120),
  temporal_resolution TEXT NOT NULL CHECK (length(trim(temporal_resolution)) BETWEEN 1 AND 120),
  grid_reference TEXT NOT NULL CHECK (length(trim(grid_reference)) BETWEEN 1 AND 240),
  spatial_match_notes TEXT NOT NULL CHECK (length(trim(spatial_match_notes)) BETWEEN 1 AND 4000),
  model_name TEXT,
  scenario_name TEXT,
  hazard_metric TEXT NOT NULL CHECK (length(trim(hazard_metric)) BETWEEN 1 AND 120),
  metric_value NUMERIC(24,8) NOT NULL,
  metric_unit TEXT NOT NULL CHECK (length(trim(metric_unit)) BETWEEN 1 AND 100),
  uncertainty_notes TEXT NOT NULL CHECK (length(trim(uncertainty_notes)) BETWEEN 1 AND 4000),
  exposure_rating SMALLINT NOT NULL CHECK (exposure_rating BETWEEN 1 AND 5),
  vulnerability_rating SMALLINT NOT NULL CHECK (vulnerability_rating BETWEEN 1 AND 5),
  business_dependency_percent NUMERIC(6,3) NOT NULL CHECK (business_dependency_percent BETWEEN 0 AND 100),
  priority_band TEXT NOT NULL CHECK (priority_band IN ('low', 'medium', 'high')),
  screening_status TEXT NOT NULL DEFAULT 'needs_specialist_review' CHECK (screening_status = 'needs_specialist_review'),
  rating_rationale TEXT NOT NULL CHECK (length(trim(rating_rationale)) BETWEEN 1 AND 4000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id), UNIQUE(id, company_id, facility_revision_id, hazard_type),
  CHECK (horizon_end >= horizon_start),
  CHECK ((scenario_kind = 'historical' AND source_kind <> 'CMIP6') OR (scenario_kind = 'projection' AND source_kind <> 'ERA5_LAND')),
  CHECK (scenario_kind = 'historical' OR (length(trim(COALESCE(model_name,''))) > 0 AND length(trim(COALESCE(scenario_name,''))) > 0)),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_revision_id, company_id, facility_revision_id) REFERENCES public.climate_risk_location_revisions(id, company_id, facility_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.climate_risk_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_reference TEXT NOT NULL CHECK (length(trim(portfolio_reference)) BETWEEN 1 AND 120),
  scenario_kind TEXT NOT NULL CHECK (scenario_kind IN ('historical', 'projection')),
  scenario_reference TEXT NOT NULL,
  horizon_start DATE NOT NULL,
  horizon_end DATE NOT NULL,
  facility_count INTEGER NOT NULL CHECK (facility_count >= 2),
  assessment_count INTEGER NOT NULL CHECK (assessment_count >= facility_count),
  priority_summary JSONB NOT NULL CHECK (jsonb_typeof(priority_summary) = 'object'),
  methodology_notes TEXT NOT NULL CHECK (length(trim(methodology_notes)) BETWEEN 1 AND 4000),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id), UNIQUE(company_id, portfolio_reference, input_sha256),
  CHECK (horizon_end >= horizon_start)
);

CREATE TABLE IF NOT EXISTS public.climate_risk_portfolio_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL,
  assessment_id UUID NOT NULL,
  facility_revision_id UUID NOT NULL,
  hazard_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, assessment_id), UNIQUE(portfolio_id, facility_revision_id, hazard_type),
  FOREIGN KEY (portfolio_id, company_id) REFERENCES public.climate_risk_portfolio_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (assessment_id, company_id, facility_revision_id, hazard_type)
    REFERENCES public.climate_risk_assessments(id, company_id, facility_revision_id, hazard_type) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_climate_location_facility ON public.climate_risk_location_revisions(company_id, facility_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_location_evidence ON public.climate_risk_location_revisions(company_id, evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_climate_assessment_scenario ON public.climate_risk_assessments(company_id, scenario_kind, scenario_reference, horizon_start, horizon_end);
CREATE INDEX IF NOT EXISTS idx_climate_assessment_facility ON public.climate_risk_assessments(company_id, facility_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_assessment_location ON public.climate_risk_assessments(company_id, location_revision_id);
CREATE INDEX IF NOT EXISTS idx_climate_assessment_evidence ON public.climate_risk_assessments(company_id, evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_climate_portfolio_scenario ON public.climate_risk_portfolio_snapshots(company_id, scenario_kind, scenario_reference, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_portfolio_member_assessment ON public.climate_risk_portfolio_members(company_id, assessment_id);

DROP TRIGGER IF EXISTS trg_climate_location_immutable ON public.climate_risk_location_revisions;
CREATE TRIGGER trg_climate_location_immutable BEFORE UPDATE OR DELETE ON public.climate_risk_location_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_climate_assessment_immutable ON public.climate_risk_assessments;
CREATE TRIGGER trg_climate_assessment_immutable BEFORE UPDATE OR DELETE ON public.climate_risk_assessments FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_climate_portfolio_immutable ON public.climate_risk_portfolio_snapshots;
CREATE TRIGGER trg_climate_portfolio_immutable BEFORE UPDATE OR DELETE ON public.climate_risk_portfolio_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_climate_portfolio_member_immutable ON public.climate_risk_portfolio_members;
CREATE TRIGGER trg_climate_portfolio_member_immutable BEFORE UPDATE OR DELETE ON public.climate_risk_portfolio_members FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
