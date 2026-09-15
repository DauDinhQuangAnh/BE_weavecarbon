-- G2-03 Vietnam facility GHG/MRV preparation lifecycle.
-- This is an internal preparation ledger; external submission requires a separately evidenced event.

CREATE TABLE IF NOT EXISTS public.vn_mrv_case_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  case_reference TEXT NOT NULL CHECK (length(trim(case_reference)) BETWEEN 1 AND 120), revision INTEGER NOT NULL CHECK (revision > 0),
  facility_revision_id UUID NOT NULL, reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 2020 AND 2200),
  sector TEXT NOT NULL CHECK (sector IN ('energy', 'industry_trade', 'transport', 'construction', 'agriculture_environment', 'waste', 'other')),
  applicability_status TEXT NOT NULL CHECK (applicability_status IN ('confirmed_listed', 'potentially_listed', 'not_listed', 'undetermined')),
  listing_reference TEXT, listing_evidence_document_id UUID, legal_basis_snapshot JSONB NOT NULL CHECK (jsonb_typeof(legal_basis_snapshot) = 'object'),
  assessment_date DATE NOT NULL, rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, case_reference, revision), UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (listing_evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.vn_mrv_measurement_plan_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  case_id UUID NOT NULL, plan_reference TEXT NOT NULL CHECK (length(trim(plan_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0), organizational_boundary JSONB NOT NULL CHECK (jsonb_typeof(organizational_boundary) = 'object'),
  operational_boundary JSONB NOT NULL CHECK (jsonb_typeof(operational_boundary) = 'object'), source_map JSONB NOT NULL CHECK (jsonb_typeof(source_map) = 'array'),
  methodology JSONB NOT NULL CHECK (jsonb_typeof(methodology) = 'object'), qaqc_plan JSONB NOT NULL CHECK (jsonb_typeof(qaqc_plan) = 'object'),
  uncertainty_plan JSONB NOT NULL CHECK (jsonb_typeof(uncertainty_plan) = 'object'), dql_assessment_ids JSONB NOT NULL CHECK (jsonb_typeof(dql_assessment_ids) = 'array'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'), plan_sha256 TEXT NOT NULL CHECK (plan_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, plan_reference, revision), UNIQUE(id, company_id),
  FOREIGN KEY (case_id, company_id) REFERENCES public.vn_mrv_case_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.vn_mrv_filing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  case_id UUID NOT NULL, measurement_plan_id UUID NOT NULL, corporate_inventory_id UUID NOT NULL,
  template_reference TEXT NOT NULL, template_version TEXT NOT NULL, payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'), readiness_status TEXT NOT NULL CHECK (readiness_status IN ('needs_information', 'ready_for_specialist_review')),
  blockers JSONB NOT NULL CHECK (jsonb_typeof(blockers) = 'array'), evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  disclaimer TEXT NOT NULL, created_by UUID REFERENCES public.users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, case_id, payload_sha256), UNIQUE(id, company_id),
  FOREIGN KEY (case_id, company_id) REFERENCES public.vn_mrv_case_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (measurement_plan_id, company_id) REFERENCES public.vn_mrv_measurement_plan_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (corporate_inventory_id, company_id) REFERENCES public.corporate_ghg_inventory_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.vn_mrv_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  filing_snapshot_id UUID NOT NULL, event_type TEXT NOT NULL CHECK (event_type IN ('specialist_review_completed', 'verification_received', 'submission_recorded', 'authority_feedback_received')),
  external_reference TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, evidence_document_id UUID NOT NULL,
  notes TEXT, recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (filing_snapshot_id, company_id) REFERENCES public.vn_mrv_filing_snapshots(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_vn_mrv_cases_tenant ON public.vn_mrv_case_revisions(company_id, case_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_vn_mrv_plans_tenant ON public.vn_mrv_measurement_plan_revisions(company_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vn_mrv_filings_tenant ON public.vn_mrv_filing_snapshots(company_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vn_mrv_events_tenant ON public.vn_mrv_external_events(company_id, filing_snapshot_id, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_vn_mrv_case_immutable ON public.vn_mrv_case_revisions;
CREATE TRIGGER trg_vn_mrv_case_immutable BEFORE UPDATE OR DELETE ON public.vn_mrv_case_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_vn_mrv_plan_immutable ON public.vn_mrv_measurement_plan_revisions;
CREATE TRIGGER trg_vn_mrv_plan_immutable BEFORE UPDATE OR DELETE ON public.vn_mrv_measurement_plan_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_vn_mrv_filing_immutable ON public.vn_mrv_filing_snapshots;
CREATE TRIGGER trg_vn_mrv_filing_immutable BEFORE UPDATE OR DELETE ON public.vn_mrv_filing_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_vn_mrv_event_immutable ON public.vn_mrv_external_events;
CREATE TRIGGER trg_vn_mrv_event_immutable BEFORE UPDATE OR DELETE ON public.vn_mrv_external_events FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
