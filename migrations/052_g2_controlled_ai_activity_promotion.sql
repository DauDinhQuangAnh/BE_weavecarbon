-- G2-14 controlled AI/OCR semantic mapping and promotion into industrial activity records.
-- Suggestions remain non-authoritative. A named company administrator must create an
-- immutable reviewed candidate and then explicitly promote it in a separate transaction.

CREATE TABLE IF NOT EXISTS public.evidence_ai_activity_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evidence_document_id UUID NOT NULL,
  extraction_review_id UUID NOT NULL,
  candidate_reference TEXT NOT NULL CHECK (length(trim(candidate_reference)) BETWEEN 1 AND 160),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('blocked','ready_for_promotion')),
  suggestion_engine TEXT NOT NULL CHECK (length(trim(suggestion_engine)) BETWEEN 1 AND 200),
  suggestion_engine_version TEXT NOT NULL CHECK (length(trim(suggestion_engine_version)) BETWEEN 1 AND 120),
  suggestion_sha256 TEXT NOT NULL CHECK (suggestion_sha256 ~* '^[a-f0-9]{64}$'),
  source_evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_evidence_snapshot) = 'object'),
  field_decisions JSONB NOT NULL CHECK (jsonb_typeof(field_decisions) = 'array'),
  anomaly_snapshot JSONB NOT NULL CHECK (jsonb_typeof(anomaly_snapshot) = 'array'),
  anomaly_resolutions JSONB NOT NULL CHECK (jsonb_typeof(anomaly_resolutions) = 'array'),
  evidence_match_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_match_snapshot) = 'array'),
  canonical_payload JSONB NOT NULL CHECK (jsonb_typeof(canonical_payload) = 'object'),
  blocker_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  warning_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 5000),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, candidate_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (extraction_review_id, company_id)
    REFERENCES public.evidence_ai_extraction_reviews(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ai_activity_candidate_review
  ON public.evidence_ai_activity_candidates(company_id, extraction_review_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.evidence_ai_activity_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL,
  extraction_review_id UUID NOT NULL,
  evidence_document_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  promoter_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  promoter_name_snapshot TEXT NOT NULL CHECK (length(trim(promoter_name_snapshot)) BETWEEN 1 AND 320),
  promoter_role TEXT NOT NULL CHECK (promoter_role = 'industrial_activity_promoter'),
  attestation TEXT NOT NULL CHECK (length(trim(attestation)) BETWEEN 20 AND 5000),
  evidence_checksum_sha256 TEXT NOT NULL CHECK (evidence_checksum_sha256 ~* '^[a-f0-9]{64}$'),
  extraction_sha256 TEXT NOT NULL CHECK (extraction_sha256 ~* '^[a-f0-9]{64}$'),
  candidate_payload_sha256 TEXT NOT NULL CHECK (candidate_payload_sha256 ~* '^[a-f0-9]{64}$'),
  promotion_sha256 TEXT NOT NULL CHECK (promotion_sha256 ~* '^[a-f0-9]{64}$'),
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, candidate_id),
  UNIQUE(company_id, activity_id),
  UNIQUE(id, company_id),
  FOREIGN KEY (candidate_id, company_id)
    REFERENCES public.evidence_ai_activity_candidates(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (extraction_review_id, company_id)
    REFERENCES public.evidence_ai_extraction_reviews(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (activity_id, company_id)
    REFERENCES public.industrial_activity_records(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ai_activity_promotion_evidence
  ON public.evidence_ai_activity_promotions(company_id, evidence_document_id, promoted_at DESC);

DROP TRIGGER IF EXISTS trg_ai_activity_candidate_immutable ON public.evidence_ai_activity_candidates;
CREATE TRIGGER trg_ai_activity_candidate_immutable BEFORE UPDATE OR DELETE ON public.evidence_ai_activity_candidates
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_ai_activity_promotion_immutable ON public.evidence_ai_activity_promotions;
CREATE TRIGGER trg_ai_activity_promotion_immutable BEFORE UPDATE OR DELETE ON public.evidence_ai_activity_promotions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
