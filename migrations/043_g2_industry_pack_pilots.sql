-- G2-05 steel and cement industry-pack pilot snapshots. Expert approval is a separate gate.
CREATE TABLE IF NOT EXISTS public.industry_pack_pilot_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  process_revision_id UUID NOT NULL,
  study_reference TEXT NOT NULL CHECK (length(trim(study_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  pack_id TEXT NOT NULL CHECK (pack_id IN ('steel', 'cement')),
  pack_version TEXT NOT NULL,
  pack_approval_status TEXT NOT NULL CHECK (pack_approval_status = 'expert_review_required'),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  status TEXT NOT NULL CHECK (status IN ('needs_information', 'specialist_review_required')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, study_reference, revision), UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (process_revision_id, company_id) REFERENCES public.industrial_process_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_industry_pack_pilot_tenant ON public.industry_pack_pilot_snapshots(company_id, study_reference, revision DESC);
DROP TRIGGER IF EXISTS trg_industry_pack_pilot_immutable ON public.industry_pack_pilot_snapshots;
CREATE TRIGGER trg_industry_pack_pilot_immutable BEFORE UPDATE OR DELETE ON public.industry_pack_pilot_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
