-- Append-only human review and internal issue records for immutable Audit Packs.

ALTER TABLE public.audit_bundle_evidence
  ADD COLUMN IF NOT EXISTS factor_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(factor_version_ids) = 'array'),
  ADD COLUMN IF NOT EXISTS calculation_term_numbers JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(calculation_term_numbers) = 'array');

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_bundles_company_id_id
  ON public.audit_bundles(company_id, id);

CREATE TABLE IF NOT EXISTS public.audit_bundle_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audit_bundle_id UUID NOT NULL REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  qa_exceptions JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(qa_exceptions) = 'array'),
  notes TEXT,
  reviewed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, audit_bundle_id)
    REFERENCES public.audit_bundles(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_bundle_reviews_latest
  ON public.audit_bundle_reviews(company_id, audit_bundle_id, reviewed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.audit_bundle_issuances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audit_bundle_id UUID NOT NULL UNIQUE REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  assertion_text TEXT NOT NULL CHECK (length(trim(assertion_text)) > 0),
  criteria TEXT NOT NULL CHECK (length(trim(criteria)) > 0),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~* '^[a-f0-9]{64}$'),
  bundle_sha256 TEXT NOT NULL CHECK (bundle_sha256 ~* '^[a-f0-9]{64}$'),
  issued_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, audit_bundle_id)
    REFERENCES public.audit_bundles(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_bundle_issuances_company
  ON public.audit_bundle_issuances(company_id, issued_at DESC);

CREATE OR REPLACE FUNCTION public.reject_audit_lifecycle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit review and issuance records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_bundle_reviews_append_only ON public.audit_bundle_reviews;
CREATE TRIGGER trg_audit_bundle_reviews_append_only
BEFORE UPDATE OR DELETE ON public.audit_bundle_reviews
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_lifecycle_mutation();

DROP TRIGGER IF EXISTS trg_audit_bundle_issuances_append_only ON public.audit_bundle_issuances;
CREATE TRIGGER trg_audit_bundle_issuances_append_only
BEFORE UPDATE OR DELETE ON public.audit_bundle_issuances
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_lifecycle_mutation();
