-- R12 immutable product carbon footprint study revisions and practitioner reviews.
-- These records support an internal partial CFP and do not create ISO certification or assurance.

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_assessment_snapshots_company_id_id
  ON public.product_assessment_snapshots(company_id, id);

CREATE TABLE IF NOT EXISTS public.pcf_study_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  product_id UUID NOT NULL,
  calculation_snapshot_id UUID NOT NULL,
  study_reference TEXT NOT NULL CHECK (length(trim(study_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  study_date DATE NOT NULL,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  calculation_canonical_input_hash TEXT NOT NULL CHECK (calculation_canonical_input_hash ~* '^[a-f0-9]{64}$'),
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN ('needs_information', 'practitioner_review_required')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, study_reference, revision),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id) REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, calculation_snapshot_id)
    REFERENCES public.product_assessment_snapshots(company_id, id) ON DELETE RESTRICT,
  CHECK (reporting_period_end >= reporting_period_start)
);

CREATE INDEX IF NOT EXISTS idx_pcf_studies_tenant
  ON public.pcf_study_revisions(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcf_studies_reference
  ON public.pcf_study_revisions(company_id, shipment_id, study_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_pcf_studies_calculation
  ON public.pcf_study_revisions(company_id, product_id, calculation_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_pcf_studies_created_by ON public.pcf_study_revisions(created_by);

CREATE TABLE IF NOT EXISTS public.pcf_study_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  study_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'pcf_practitioner_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_internal_report', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  calculation_canonical_input_hash TEXT NOT NULL CHECK (calculation_canonical_input_hash ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (study_id, company_id, shipment_id)
    REFERENCES public.pcf_study_revisions(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pcf_study_reviews_study
  ON public.pcf_study_reviews(company_id, shipment_id, study_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcf_study_reviews_reviewer ON public.pcf_study_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION public.reject_pcf_study_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PCF study revisions and reviews are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_pcf_studies_immutable ON public.pcf_study_revisions;
CREATE TRIGGER trg_pcf_studies_immutable BEFORE UPDATE OR DELETE ON public.pcf_study_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_pcf_study_mutation();
DROP TRIGGER IF EXISTS trg_pcf_study_reviews_immutable ON public.pcf_study_reviews;
CREATE TRIGGER trg_pcf_study_reviews_immutable BEFORE UPDATE OR DELETE ON public.pcf_study_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_pcf_study_mutation();
