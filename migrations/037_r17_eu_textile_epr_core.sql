-- R17 immutable EU-core textile, textile-related and footwear EPR planning/reconciliation records.
-- National registration, submission and payment claims require append-only external evidence events.

CREATE TABLE IF NOT EXISTS public.eu_textile_epr_assessment_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  assessment_reference TEXT NOT NULL CHECK (length(trim(assessment_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  member_state CHAR(2) NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  assessment_date DATE NOT NULL,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  shipment_snapshot JSONB NOT NULL CHECK (jsonb_typeof(shipment_snapshot) = 'array'),
  shipment_snapshot_sha256 TEXT NOT NULL CHECK (shipment_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN ('needs_information', 'specialist_review_required')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, assessment_reference, revision),
  UNIQUE(id, company_id),
  CHECK (reporting_period_end >= reporting_period_start)
);

CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_assessment_tenant
  ON public.eu_textile_epr_assessment_revisions(company_id, member_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_assessment_reference
  ON public.eu_textile_epr_assessment_revisions(company_id, assessment_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_assessment_created_by
  ON public.eu_textile_epr_assessment_revisions(created_by);

CREATE TABLE IF NOT EXISTS public.eu_textile_epr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'eu_epr_specialist'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_internal_planning', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  shipment_snapshot_sha256 TEXT NOT NULL CHECK (shipment_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (assessment_id, company_id)
    REFERENCES public.eu_textile_epr_assessment_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_reviews
  ON public.eu_textile_epr_reviews(company_id, assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_reviews_reviewer ON public.eu_textile_epr_reviews(reviewer_id);

CREATE TABLE IF NOT EXISTS public.eu_textile_epr_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('authority_registration_confirmed', 'pro_membership_confirmed',
    'report_submission_confirmed', 'fee_payment_confirmed', 'authority_rejected', 'registration_withdrawn')),
  external_reference TEXT NOT NULL CHECK (length(trim(external_reference)) > 0),
  actor_name TEXT NOT NULL CHECK (length(trim(actor_name)) > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18, 4) CHECK (amount IS NULL OR amount >= 0),
  currency CHAR(3),
  reporting_period_start DATE,
  reporting_period_end DATE,
  evidence_document_id UUID NOT NULL REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  shipment_snapshot_sha256 TEXT NOT NULL CHECK (shipment_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (assessment_id, company_id)
    REFERENCES public.eu_textile_epr_assessment_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK ((reporting_period_start IS NULL AND reporting_period_end IS NULL)
    OR (reporting_period_start IS NOT NULL AND reporting_period_end >= reporting_period_start))
);

CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_external_events
  ON public.eu_textile_epr_external_events(company_id, assessment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_external_events_evidence ON public.eu_textile_epr_external_events(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_eu_textile_epr_external_events_recorded_by ON public.eu_textile_epr_external_events(recorded_by);

CREATE OR REPLACE FUNCTION public.reject_eu_textile_epr_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EU textile EPR assessments, reviews and external events are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_eu_textile_epr_assessment_immutable ON public.eu_textile_epr_assessment_revisions;
CREATE TRIGGER trg_eu_textile_epr_assessment_immutable BEFORE UPDATE OR DELETE ON public.eu_textile_epr_assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_eu_textile_epr_mutation();
DROP TRIGGER IF EXISTS trg_eu_textile_epr_reviews_immutable ON public.eu_textile_epr_reviews;
CREATE TRIGGER trg_eu_textile_epr_reviews_immutable BEFORE UPDATE OR DELETE ON public.eu_textile_epr_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_eu_textile_epr_mutation();
DROP TRIGGER IF EXISTS trg_eu_textile_epr_events_immutable ON public.eu_textile_epr_external_events;
CREATE TRIGGER trg_eu_textile_epr_events_immutable BEFORE UPDATE OR DELETE ON public.eu_textile_epr_external_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_eu_textile_epr_mutation();
