-- G2 canonical activity review ledger and evidence-lineage support.

CREATE TABLE IF NOT EXISTS public.industrial_activity_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'industrial_activity_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 5000),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (activity_id, company_id)
    REFERENCES public.industrial_activity_records(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_activity_reviews_tenant
  ON public.industrial_activity_reviews(company_id, activity_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_industrial_activity_review_immutable ON public.industrial_activity_reviews;
CREATE TRIGGER trg_industrial_activity_review_immutable BEFORE UPDATE OR DELETE ON public.industrial_activity_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
