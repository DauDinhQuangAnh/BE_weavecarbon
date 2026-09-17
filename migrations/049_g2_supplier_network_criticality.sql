-- G2-11 supplier network and transparent carbon-climate criticality baseline.
-- All governed records are append-only, tenant-bound and evidence-backed.

CREATE TABLE IF NOT EXISTS public.industrial_supplier_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_reference TEXT NOT NULL CHECK (length(trim(supplier_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) BETWEEN 1 AND 240),
  trading_name TEXT,
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  sector TEXT NOT NULL CHECK (length(trim(sector)) BETWEEN 1 AND 160),
  supplier_tier SMALLINT NOT NULL CHECK (supplier_tier BETWEEN 1 AND 4),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('prospective','active','inactive')),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  profile_sha256 TEXT NOT NULL CHECK (profile_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, supplier_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.industrial_supplier_site_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_revision_id UUID NOT NULL,
  site_reference TEXT NOT NULL CHECK (length(trim(site_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  site_name TEXT NOT NULL CHECK (length(trim(site_name)) BETWEEN 1 AND 240),
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  precision_meters INTEGER NOT NULL CHECK (precision_meters BETWEEN 1 AND 100000),
  location_basis TEXT NOT NULL CHECK (length(trim(location_basis)) BETWEEN 1 AND 2000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  site_sha256 TEXT NOT NULL CHECK (site_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, supplier_revision_id, site_reference, revision),
  UNIQUE(id, company_id),
  UNIQUE(id, company_id, supplier_revision_id),
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.industrial_supplier_relationship_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_revision_id UUID NOT NULL,
  relationship_reference TEXT NOT NULL CHECK (length(trim(relationship_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  material_or_service TEXT NOT NULL CHECK (length(trim(material_or_service)) BETWEEN 1 AND 240),
  procurement_category TEXT NOT NULL CHECK (length(trim(procurement_category)) BETWEEN 1 AND 160),
  spend_percent NUMERIC(6,3) NOT NULL CHECK (spend_percent BETWEEN 0 AND 100),
  production_dependency_percent NUMERIC(6,3) NOT NULL CHECK (production_dependency_percent BETWEEN 0 AND 100),
  single_source BOOLEAN NOT NULL,
  dependent_sku_count INTEGER NOT NULL CHECK (dependent_sku_count >= 0),
  dependent_route_count INTEGER NOT NULL CHECK (dependent_route_count >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  relationship_sha256 TEXT NOT NULL CHECK (relationship_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, relationship_reference, revision),
  UNIQUE(id, company_id),
  UNIQUE(id, company_id, supplier_revision_id),
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS public.industrial_supplier_climate_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_revision_id UUID NOT NULL,
  site_revision_id UUID NOT NULL,
  hazard_type TEXT NOT NULL CHECK (hazard_type IN ('heat','drought','extreme_rainfall')),
  scenario_kind TEXT NOT NULL CHECK (scenario_kind IN ('historical','projection')),
  scenario_reference TEXT NOT NULL CHECK (length(trim(scenario_reference)) BETWEEN 1 AND 120),
  horizon_start DATE NOT NULL,
  horizon_end DATE NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('ERA5_LAND','CMIP6','OTHER')),
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
  priority_band TEXT NOT NULL CHECK (priority_band IN ('low','medium','high')),
  rating_rationale TEXT NOT NULL CHECK (length(trim(rating_rationale)) BETWEEN 1 AND 4000),
  screening_status TEXT NOT NULL DEFAULT 'needs_specialist_review' CHECK (screening_status = 'needs_specialist_review'),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (site_revision_id, company_id, supplier_revision_id) REFERENCES public.industrial_supplier_site_revisions(id, company_id, supplier_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (horizon_end >= horizon_start),
  CHECK ((scenario_kind = 'historical' AND source_kind <> 'CMIP6') OR (scenario_kind = 'projection' AND source_kind <> 'ERA5_LAND')),
  CHECK (scenario_kind = 'historical' OR (length(trim(COALESCE(model_name,''))) > 0 AND length(trim(COALESCE(scenario_name,''))) > 0))
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_subject_carbon_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('facility','supplier')),
  facility_revision_id UUID,
  supplier_revision_id UUID,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  gross_kg_co2e NUMERIC(24,8) NOT NULL CHECK (gross_kg_co2e >= 0),
  activity_quantity NUMERIC(24,8),
  activity_unit TEXT,
  intensity_kg_co2e NUMERIC(24,8),
  boundary TEXT NOT NULL CHECK (length(trim(boundary)) BETWEEN 1 AND 4000),
  methodology_reference TEXT NOT NULL CHECK (length(trim(methodology_reference)) BETWEEN 1 AND 500),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('supplier_specific','facility_inventory','estimated','proxy')),
  data_quality_level TEXT NOT NULL CHECK (data_quality_level IN ('L1','L2','L3','L4','L5')),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  carbon_sha256 TEXT NOT NULL CHECK (carbon_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  UNIQUE(company_id, carbon_sha256),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (reporting_period_end >= reporting_period_start),
  CHECK ((activity_quantity IS NULL AND activity_unit IS NULL AND intensity_kg_co2e IS NULL) OR
         (activity_quantity > 0 AND length(trim(activity_unit)) > 0 AND intensity_kg_co2e >= 0)),
  CHECK ((subject_kind = 'facility' AND facility_revision_id IS NOT NULL AND supplier_revision_id IS NULL) OR
         (subject_kind = 'supplier' AND supplier_revision_id IS NOT NULL AND facility_revision_id IS NULL))
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_criticality_model_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_reference TEXT NOT NULL CHECK (length(trim(model_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  carbon_weight_percent NUMERIC(6,3) NOT NULL CHECK (carbon_weight_percent BETWEEN 0 AND 100),
  climate_weight_percent NUMERIC(6,3) NOT NULL CHECK (climate_weight_percent BETWEEN 0 AND 100),
  dependency_weight_percent NUMERIC(6,3) NOT NULL CHECK (dependency_weight_percent BETWEEN 0 AND 100),
  medium_threshold NUMERIC(7,4) NOT NULL CHECK (medium_threshold BETWEEN 0 AND 100),
  high_threshold NUMERIC(7,4) NOT NULL CHECK (high_threshold BETWEEN 0 AND 100),
  normalization_policy TEXT NOT NULL CHECK (length(trim(normalization_policy)) BETWEEN 1 AND 5000),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('draft','approved')),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  model_sha256 TEXT NOT NULL CHECK (model_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, model_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (carbon_weight_percent + climate_weight_percent + dependency_weight_percent = 100),
  CHECK (medium_threshold < high_threshold)
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_criticality_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('facility','supplier')),
  facility_revision_id UUID,
  supplier_revision_id UUID,
  relationship_revision_id UUID,
  carbon_snapshot_id UUID NOT NULL,
  model_revision_id UUID NOT NULL,
  assessment_period_start DATE NOT NULL,
  assessment_period_end DATE NOT NULL,
  normalized_carbon_score NUMERIC(7,4) NOT NULL CHECK (normalized_carbon_score BETWEEN 0 AND 100),
  normalized_climate_score NUMERIC(7,4) NOT NULL CHECK (normalized_climate_score BETWEEN 0 AND 100),
  normalized_dependency_score NUMERIC(7,4) NOT NULL CHECK (normalized_dependency_score BETWEEN 0 AND 100),
  carbon_score_rationale TEXT NOT NULL CHECK (length(trim(carbon_score_rationale)) BETWEEN 1 AND 4000),
  climate_score_rationale TEXT NOT NULL CHECK (length(trim(climate_score_rationale)) BETWEEN 1 AND 4000),
  dependency_score_rationale TEXT NOT NULL CHECK (length(trim(dependency_score_rationale)) BETWEEN 1 AND 4000),
  weighted_score NUMERIC(7,4) NOT NULL CHECK (weighted_score BETWEEN 0 AND 100),
  priority_band TEXT NOT NULL CHECK (priority_band IN ('low','medium','high')),
  review_status TEXT NOT NULL DEFAULT 'needs_specialist_review' CHECK (review_status = 'needs_specialist_review'),
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  UNIQUE(company_id, input_sha256),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (relationship_revision_id, company_id, supplier_revision_id) REFERENCES public.industrial_supplier_relationship_revisions(id, company_id, supplier_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (carbon_snapshot_id, company_id) REFERENCES public.carbon_climate_subject_carbon_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_revision_id, company_id) REFERENCES public.carbon_climate_criticality_model_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (assessment_period_end >= assessment_period_start),
  CHECK ((subject_kind = 'facility' AND facility_revision_id IS NOT NULL AND supplier_revision_id IS NULL AND relationship_revision_id IS NULL) OR
         (subject_kind = 'supplier' AND supplier_revision_id IS NOT NULL AND facility_revision_id IS NULL AND relationship_revision_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_criticality_climate_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  criticality_snapshot_id UUID NOT NULL,
  facility_climate_assessment_id UUID,
  supplier_climate_assessment_id UUID,
  hazard_type TEXT NOT NULL CHECK (hazard_type IN ('heat','drought','extreme_rainfall')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(criticality_snapshot_id, hazard_type),
  FOREIGN KEY (criticality_snapshot_id, company_id) REFERENCES public.carbon_climate_criticality_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_climate_assessment_id, company_id) REFERENCES public.climate_risk_assessments(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_climate_assessment_id, company_id) REFERENCES public.industrial_supplier_climate_assessments(id, company_id) ON DELETE RESTRICT,
  CHECK ((facility_climate_assessment_id IS NOT NULL)::integer + (supplier_climate_assessment_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_criticality_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_reference TEXT NOT NULL CHECK (length(trim(portfolio_reference)) BETWEEN 1 AND 120),
  model_revision_id UUID NOT NULL,
  assessment_period_start DATE NOT NULL,
  assessment_period_end DATE NOT NULL,
  subject_count INTEGER NOT NULL CHECK (subject_count >= 2),
  priority_summary JSONB NOT NULL CHECK (jsonb_typeof(priority_summary) = 'object'),
  coverage_summary JSONB NOT NULL CHECK (jsonb_typeof(coverage_summary) = 'object'),
  methodology_notes TEXT NOT NULL CHECK (length(trim(methodology_notes)) BETWEEN 1 AND 5000),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  UNIQUE(company_id, portfolio_reference, input_sha256),
  FOREIGN KEY (model_revision_id, company_id) REFERENCES public.carbon_climate_criticality_model_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (assessment_period_end >= assessment_period_start)
);

CREATE TABLE IF NOT EXISTS public.carbon_climate_criticality_portfolio_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL,
  criticality_snapshot_id UUID NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('facility','supplier')),
  facility_revision_id UUID,
  supplier_revision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, criticality_snapshot_id),
  UNIQUE(portfolio_id, facility_revision_id),
  UNIQUE(portfolio_id, supplier_revision_id),
  FOREIGN KEY (portfolio_id, company_id) REFERENCES public.carbon_climate_criticality_portfolio_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (criticality_snapshot_id, company_id) REFERENCES public.carbon_climate_criticality_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_revision_id, company_id) REFERENCES public.industrial_supplier_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK ((subject_kind = 'facility' AND facility_revision_id IS NOT NULL AND supplier_revision_id IS NULL) OR
         (subject_kind = 'supplier' AND supplier_revision_id IS NOT NULL AND facility_revision_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_supplier_profile_reference ON public.industrial_supplier_revisions(company_id,supplier_reference,revision DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_site_reference ON public.industrial_supplier_site_revisions(company_id,supplier_revision_id,site_reference,revision DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_relationship_reference ON public.industrial_supplier_relationship_revisions(company_id,relationship_reference,revision DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_climate_scenario ON public.industrial_supplier_climate_assessments(company_id,scenario_kind,scenario_reference,horizon_start,horizon_end);
CREATE INDEX IF NOT EXISTS idx_subject_carbon_period ON public.carbon_climate_subject_carbon_snapshots(company_id,subject_kind,reporting_period_start,reporting_period_end);
CREATE INDEX IF NOT EXISTS idx_criticality_subject ON public.carbon_climate_criticality_snapshots(company_id,subject_kind,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_criticality_portfolio_created ON public.carbon_climate_criticality_portfolio_snapshots(company_id,created_at DESC);

DROP TRIGGER IF EXISTS trg_supplier_profile_immutable ON public.industrial_supplier_revisions;
CREATE TRIGGER trg_supplier_profile_immutable BEFORE UPDATE OR DELETE ON public.industrial_supplier_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_supplier_site_immutable ON public.industrial_supplier_site_revisions;
CREATE TRIGGER trg_supplier_site_immutable BEFORE UPDATE OR DELETE ON public.industrial_supplier_site_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_supplier_relationship_immutable ON public.industrial_supplier_relationship_revisions;
CREATE TRIGGER trg_supplier_relationship_immutable BEFORE UPDATE OR DELETE ON public.industrial_supplier_relationship_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_supplier_climate_immutable ON public.industrial_supplier_climate_assessments;
CREATE TRIGGER trg_supplier_climate_immutable BEFORE UPDATE OR DELETE ON public.industrial_supplier_climate_assessments FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_subject_carbon_immutable ON public.carbon_climate_subject_carbon_snapshots;
CREATE TRIGGER trg_subject_carbon_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_subject_carbon_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_criticality_model_immutable ON public.carbon_climate_criticality_model_revisions;
CREATE TRIGGER trg_criticality_model_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_criticality_model_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_criticality_snapshot_immutable ON public.carbon_climate_criticality_snapshots;
CREATE TRIGGER trg_criticality_snapshot_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_criticality_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_criticality_climate_member_immutable ON public.carbon_climate_criticality_climate_members;
CREATE TRIGGER trg_criticality_climate_member_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_criticality_climate_members FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_criticality_portfolio_immutable ON public.carbon_climate_criticality_portfolio_snapshots;
CREATE TRIGGER trg_criticality_portfolio_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_criticality_portfolio_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_criticality_portfolio_member_immutable ON public.carbon_climate_criticality_portfolio_members;
CREATE TRIGGER trg_criticality_portfolio_member_immutable BEFORE UPDATE OR DELETE ON public.carbon_climate_criticality_portfolio_members FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
