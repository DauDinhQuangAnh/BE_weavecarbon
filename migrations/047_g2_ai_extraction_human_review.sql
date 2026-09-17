-- G2-09 field-level human review for AI/OCR extraction.
-- AI output remains a suggestion until a named reviewer confirms every field.

CREATE TABLE IF NOT EXISTS public.evidence_ai_extraction_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evidence_document_id UUID NOT NULL,
  evidence_checksum_sha256 TEXT NOT NULL CHECK (evidence_checksum_sha256 ~* '^[a-f0-9]{64}$'),
  extraction_sha256 TEXT NOT NULL CHECK (extraction_sha256 ~* '^[a-f0-9]{64}$'),
  extraction_snapshot JSONB NOT NULL CHECK (jsonb_typeof(extraction_snapshot) = 'object'),
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'evidence_ai_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_mapping', 'needs_correction', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_evidence_ai_reviews_tenant
  ON public.evidence_ai_extraction_reviews(company_id, evidence_document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.evidence_ai_field_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  review_id UUID NOT NULL,
  field_path TEXT NOT NULL CHECK (length(trim(field_path)) BETWEEN 1 AND 500),
  ai_value JSONB NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'corrected', 'rejected')),
  confirmed_value JSONB NOT NULL,
  canonical_field TEXT NOT NULL CHECK (length(trim(canonical_field)) BETWEEN 1 AND 500),
  field_sha256 TEXT NOT NULL CHECK (field_sha256 ~* '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, review_id, field_path),
  FOREIGN KEY (review_id, company_id)
    REFERENCES public.evidence_ai_extraction_reviews(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_evidence_ai_field_decisions_review
  ON public.evidence_ai_field_decisions(company_id, review_id, field_path);

DROP TRIGGER IF EXISTS trg_evidence_ai_review_immutable ON public.evidence_ai_extraction_reviews;
CREATE TRIGGER trg_evidence_ai_review_immutable BEFORE UPDATE OR DELETE ON public.evidence_ai_extraction_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_evidence_ai_field_decision_immutable ON public.evidence_ai_field_decisions;
CREATE TRIGGER trg_evidence_ai_field_decision_immutable BEFORE UPDATE OR DELETE ON public.evidence_ai_field_decisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
