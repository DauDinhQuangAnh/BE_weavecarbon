-- R18 immutable environmental-claim dossier revisions and legal-review events.
-- Approval is derived against current evidence; these rows never grant regulator approval.

CREATE TABLE IF NOT EXISTS public.environmental_claim_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  claim_reference TEXT NOT NULL CHECK (length(trim(claim_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  communication_start DATE NOT NULL,
  communication_end DATE,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN (
    'blocked_prohibited', 'needs_information', 'ready_for_legal_review', 'internal_draft'
  )),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, claim_reference, revision),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id)
    REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT,
  CHECK (communication_end IS NULL OR communication_end >= communication_start)
);

CREATE INDEX IF NOT EXISTS idx_environmental_claim_dossiers_tenant
  ON public.environmental_claim_dossiers(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_environmental_claim_dossiers_reference
  ON public.environmental_claim_dossiers(company_id, shipment_id, claim_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_environmental_claim_dossiers_created_by
  ON public.environmental_claim_dossiers(created_by);

CREATE TABLE IF NOT EXISTS public.environmental_claim_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  dossier_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'legal_claim_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN (
    'approved_for_publication', 'needs_information', 'rejected', 'withdrawn'
  )),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (dossier_id, company_id, shipment_id)
    REFERENCES public.environmental_claim_dossiers(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_environmental_claim_reviews_dossier
  ON public.environmental_claim_reviews(company_id, shipment_id, dossier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_environmental_claim_reviews_reviewer
  ON public.environmental_claim_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION public.reject_environmental_claim_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Environmental claim dossier and review records are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_environmental_claim_dossiers_immutable
  ON public.environmental_claim_dossiers;
CREATE TRIGGER trg_environmental_claim_dossiers_immutable
  BEFORE UPDATE OR DELETE ON public.environmental_claim_dossiers
  FOR EACH ROW EXECUTE FUNCTION public.reject_environmental_claim_mutation();

DROP TRIGGER IF EXISTS trg_environmental_claim_reviews_immutable
  ON public.environmental_claim_reviews;
CREATE TRIGGER trg_environmental_claim_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.environmental_claim_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_environmental_claim_mutation();
