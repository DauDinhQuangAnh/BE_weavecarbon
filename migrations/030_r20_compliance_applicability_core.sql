-- R20 source-versioned compliance applicability evaluations and specialist reviews.
-- Results are internal triage records, never permits, certificates or authority decisions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_shipments_id_company'
      AND conrelid = 'public.shipments'::regclass
  ) THEN
    ALTER TABLE public.shipments
      ADD CONSTRAINT uq_shipments_id_company UNIQUE (id, company_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.compliance_applicability_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  assessment_date DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('not_applicable', 'requirements_identified', 'specialist_review_required')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id)
    REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_compliance_applicability_evaluations_tenant
  ON public.compliance_applicability_evaluations(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_applicability_evaluations_created_by
  ON public.compliance_applicability_evaluations(created_by);

CREATE TABLE IF NOT EXISTS public.compliance_applicability_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  evaluation_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'compliance_specialist'),
  decision TEXT NOT NULL CHECK (decision IN ('confirmed_for_internal_planning', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (evaluation_id, company_id, shipment_id)
    REFERENCES public.compliance_applicability_evaluations(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_compliance_applicability_reviews_evaluation
  ON public.compliance_applicability_reviews(company_id, shipment_id, evaluation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_applicability_reviews_reviewer
  ON public.compliance_applicability_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION public.reject_compliance_applicability_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Compliance applicability records are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_compliance_applicability_evaluations_immutable
  ON public.compliance_applicability_evaluations;
CREATE TRIGGER trg_compliance_applicability_evaluations_immutable
  BEFORE UPDATE OR DELETE ON public.compliance_applicability_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.reject_compliance_applicability_mutation();

DROP TRIGGER IF EXISTS trg_compliance_applicability_reviews_immutable
  ON public.compliance_applicability_reviews;
CREATE TRIGGER trg_compliance_applicability_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.compliance_applicability_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_compliance_applicability_mutation();
