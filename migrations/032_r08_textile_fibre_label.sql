-- R08 immutable EU textile fibre-label specifications and human review events.
-- These records are internal controls and do not represent authority approval or certified translations.

CREATE TABLE IF NOT EXISTS public.textile_fibre_label_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  specification_reference TEXT NOT NULL CHECK (length(trim(specification_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  assessment_date DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN (
    'needs_information', 'specialist_review_required', 'ready_for_label_review'
  )),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, specification_reference, revision),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id)
    REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textile_fibre_label_specifications_tenant
  ON public.textile_fibre_label_specifications(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_textile_fibre_label_specifications_reference
  ON public.textile_fibre_label_specifications(company_id, shipment_id, specification_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_textile_fibre_label_specifications_created_by
  ON public.textile_fibre_label_specifications(created_by);

CREATE TABLE IF NOT EXISTS public.textile_fibre_label_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  specification_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'textile_label_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN (
    'approved_for_internal_artwork', 'needs_information', 'rejected'
  )),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (specification_id, company_id, shipment_id)
    REFERENCES public.textile_fibre_label_specifications(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_textile_fibre_label_reviews_specification
  ON public.textile_fibre_label_reviews(company_id, shipment_id, specification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_textile_fibre_label_reviews_reviewer
  ON public.textile_fibre_label_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION public.reject_textile_fibre_label_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Textile fibre label specifications and reviews are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_textile_fibre_label_specifications_immutable
  ON public.textile_fibre_label_specifications;
CREATE TRIGGER trg_textile_fibre_label_specifications_immutable
  BEFORE UPDATE OR DELETE ON public.textile_fibre_label_specifications
  FOR EACH ROW EXECUTE FUNCTION public.reject_textile_fibre_label_mutation();

DROP TRIGGER IF EXISTS trg_textile_fibre_label_reviews_immutable
  ON public.textile_fibre_label_reviews;
CREATE TRIGGER trg_textile_fibre_label_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.textile_fibre_label_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_textile_fibre_label_mutation();
