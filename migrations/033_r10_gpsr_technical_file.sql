-- R10 immutable GPSR technical-file revisions, safety reviews and post-market event ledger.
-- Nothing in these tables represents an authority filing or a declaration that a product is safe.

CREATE TABLE IF NOT EXISTS public.gpsr_technical_file_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  file_reference TEXT NOT NULL CHECK (length(trim(file_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  assessment_date DATE NOT NULL,
  first_placed_on_market_date DATE NOT NULL,
  retention_until DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN (
    'needs_information', 'specialist_review_required', 'ready_for_safety_review'
  )),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, file_reference, revision),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id) REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT,
  CHECK (retention_until >= first_placed_on_market_date)
);

CREATE INDEX IF NOT EXISTS idx_gpsr_technical_files_tenant
  ON public.gpsr_technical_file_revisions(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpsr_technical_files_reference
  ON public.gpsr_technical_file_revisions(company_id, shipment_id, file_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_gpsr_technical_files_created_by
  ON public.gpsr_technical_file_revisions(created_by);
CREATE INDEX IF NOT EXISTS idx_gpsr_technical_files_retention
  ON public.gpsr_technical_file_revisions(company_id, retention_until);

CREATE TABLE IF NOT EXISTS public.gpsr_technical_file_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  technical_file_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'product_safety_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_internal_release', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (technical_file_id, company_id, shipment_id)
    REFERENCES public.gpsr_technical_file_revisions(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_gpsr_technical_file_reviews_file
  ON public.gpsr_technical_file_reviews(company_id, shipment_id, technical_file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpsr_technical_file_reviews_reviewer
  ON public.gpsr_technical_file_reviews(reviewer_id);

CREATE TABLE IF NOT EXISTS public.gpsr_post_market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  technical_file_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'complaint', 'safety_incident', 'corrective_action', 'recall',
    'safety_business_gateway_notification', 'authority_request', 'consumer_notice'
  )),
  event_reference TEXT NOT NULL CHECK (length(trim(event_reference)) BETWEEN 1 AND 200),
  occurred_at TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  severity TEXT NOT NULL CHECK (severity IN ('information', 'minor', 'serious', 'death', 'unknown')),
  external_reference TEXT,
  evidence_document_id UUID,
  evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_file_size_bytes BIGINT CHECK (evidence_file_size_bytes IS NULL OR evidence_file_size_bytes > 0),
  consumer_personal_data_included BOOLEAN NOT NULL DEFAULT false CHECK (consumer_personal_data_included = false),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorder_name_snapshot TEXT NOT NULL CHECK (length(trim(recorder_name_snapshot)) > 0),
  recorder_email_snapshot TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, event_reference),
  FOREIGN KEY (technical_file_id, company_id, shipment_id)
    REFERENCES public.gpsr_technical_file_revisions(id, company_id, shipment_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (event_type <> 'safety_business_gateway_notification'
    OR (external_reference IS NOT NULL AND evidence_document_id IS NOT NULL
      AND evidence_sha256 IS NOT NULL AND evidence_file_size_bytes IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_gpsr_post_market_events_file
  ON public.gpsr_post_market_events(company_id, shipment_id, technical_file_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpsr_post_market_events_evidence
  ON public.gpsr_post_market_events(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_gpsr_post_market_events_recorded_by
  ON public.gpsr_post_market_events(recorded_by);

CREATE OR REPLACE FUNCTION public.reject_gpsr_record_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GPSR technical files, reviews and post-market events are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_gpsr_technical_files_immutable ON public.gpsr_technical_file_revisions;
CREATE TRIGGER trg_gpsr_technical_files_immutable BEFORE UPDATE OR DELETE ON public.gpsr_technical_file_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_gpsr_record_mutation();
DROP TRIGGER IF EXISTS trg_gpsr_technical_file_reviews_immutable ON public.gpsr_technical_file_reviews;
CREATE TRIGGER trg_gpsr_technical_file_reviews_immutable BEFORE UPDATE OR DELETE ON public.gpsr_technical_file_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_gpsr_record_mutation();
DROP TRIGGER IF EXISTS trg_gpsr_post_market_events_immutable ON public.gpsr_post_market_events;
CREATE TRIGGER trg_gpsr_post_market_events_immutable BEFORE UPDATE OR DELETE ON public.gpsr_post_market_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_gpsr_record_mutation();
