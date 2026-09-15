-- G2-02 system-wide data-quality and emission-factor governance ledgers.

CREATE TABLE IF NOT EXISTS public.industrial_dql_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('activity', 'facility', 'process', 'measurement_point', 'emission_factor')),
  subject_reference TEXT NOT NULL CHECK (length(trim(subject_reference)) BETWEEN 1 AND 240),
  methodology_version TEXT NOT NULL,
  temporal_score SMALLINT NOT NULL CHECK (temporal_score BETWEEN 1 AND 5),
  geographic_score SMALLINT NOT NULL CHECK (geographic_score BETWEEN 1 AND 5),
  technological_score SMALLINT NOT NULL CHECK (technological_score BETWEEN 1 AND 5),
  completeness_score SMALLINT NOT NULL CHECK (completeness_score BETWEEN 1 AND 5),
  reliability_score SMALLINT NOT NULL CHECK (reliability_score BETWEEN 1 AND 5),
  completeness_percent NUMERIC(5,2) NOT NULL CHECK (completeness_percent BETWEEN 0 AND 100),
  overall_score NUMERIC(4,2) NOT NULL CHECK (overall_score BETWEEN 1 AND 5),
  data_quality_level TEXT NOT NULL CHECK (data_quality_level IN ('L1', 'L2', 'L3', 'L4', 'L5')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  improvement_actions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(improvement_actions) = 'array'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  assessment_sha256 TEXT NOT NULL CHECK (assessment_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, subject_type, subject_reference, assessment_sha256)
);

CREATE INDEX IF NOT EXISTS idx_industrial_dql_tenant_subject
  ON public.industrial_dql_assessments(company_id, subject_type, subject_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emission_factor_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proposal_reference TEXT NOT NULL CHECK (length(trim(proposal_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  factor_id TEXT NOT NULL CHECK (length(trim(factor_id)) BETWEEN 1 AND 200),
  label TEXT NOT NULL,
  factor_value NUMERIC NOT NULL CHECK (factor_value >= 0),
  unit TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_year INTEGER CHECK (source_year IS NULL OR source_year BETWEEN 1900 AND 2200),
  geography TEXT NOT NULL,
  boundary TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  gwp_basis TEXT NOT NULL,
  uncertainty_cv NUMERIC NOT NULL CHECK (uncertainty_cv >= 0),
  is_proxy BOOLEAN NOT NULL DEFAULT false,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, proposal_reference, revision),
  UNIQUE(id, company_id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_emission_factor_proposal_tenant
  ON public.emission_factor_proposals(company_id, proposal_reference, revision DESC);

CREATE TABLE IF NOT EXISTS public.emission_factor_proposal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'emission_factor_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_release_candidate', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 5000),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (proposal_id, company_id)
    REFERENCES public.emission_factor_proposals(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_emission_factor_proposal_review_tenant
  ON public.emission_factor_proposal_reviews(company_id, proposal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_industrial_dql_immutable ON public.industrial_dql_assessments;
CREATE TRIGGER trg_industrial_dql_immutable BEFORE UPDATE OR DELETE ON public.industrial_dql_assessments
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_emission_factor_proposal_immutable ON public.emission_factor_proposals;
CREATE TRIGGER trg_emission_factor_proposal_immutable BEFORE UPDATE OR DELETE ON public.emission_factor_proposals
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_emission_factor_proposal_review_immutable ON public.emission_factor_proposal_reviews;
CREATE TRIGGER trg_emission_factor_proposal_review_immutable BEFORE UPDATE OR DELETE ON public.emission_factor_proposal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
