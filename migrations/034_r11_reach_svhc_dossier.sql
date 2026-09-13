-- R11 immutable REACH/SVHC dossier revisions, chemical reviews and obligation events.
-- These records are internal controls, not a generic REACH certificate or an ECHA submission.

CREATE TABLE IF NOT EXISTS public.reach_svhc_dossier_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  dossier_reference TEXT NOT NULL CHECK (length(trim(dossier_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  assessment_date DATE NOT NULL,
  candidate_list_snapshot_date DATE NOT NULL,
  reach_consolidated_date DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN ('needs_information', 'specialist_review_required', 'ready_for_chemical_review')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, shipment_id, dossier_reference, revision),
  UNIQUE(id, company_id, shipment_id),
  FOREIGN KEY (shipment_id, company_id) REFERENCES public.shipments(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reach_svhc_dossiers_tenant
  ON public.reach_svhc_dossier_revisions(company_id, shipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reach_svhc_dossiers_reference
  ON public.reach_svhc_dossier_revisions(company_id, shipment_id, dossier_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_reach_svhc_dossiers_created_by ON public.reach_svhc_dossier_revisions(created_by);
CREATE INDEX IF NOT EXISTS idx_reach_svhc_dossiers_source_dates
  ON public.reach_svhc_dossier_revisions(company_id, candidate_list_snapshot_date, reach_consolidated_date);

CREATE TABLE IF NOT EXISTS public.reach_svhc_dossier_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  dossier_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'chemical_compliance_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_internal_release', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (dossier_id, company_id, shipment_id)
    REFERENCES public.reach_svhc_dossier_revisions(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reach_svhc_reviews_dossier
  ON public.reach_svhc_dossier_reviews(company_id, shipment_id, dossier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reach_svhc_reviews_reviewer ON public.reach_svhc_dossier_reviews(reviewer_id);

CREATE TABLE IF NOT EXISTS public.reach_obligation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL,
  dossier_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'supply_chain_communication', 'consumer_request_received', 'consumer_response_sent',
    'article7_notification', 'scip_notification', 'authority_request', 'authority_response', 'corrective_action'
  )),
  event_reference TEXT NOT NULL CHECK (length(trim(event_reference)) BETWEEN 1 AND 200),
  occurred_at TIMESTAMPTZ NOT NULL,
  response_due_at TIMESTAMPTZ,
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
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
  FOREIGN KEY (dossier_id, company_id, shipment_id)
    REFERENCES public.reach_svhc_dossier_revisions(id, company_id, shipment_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (event_type <> 'consumer_request_received' OR response_due_at IS NOT NULL),
  CHECK (event_type NOT IN ('supply_chain_communication', 'consumer_response_sent', 'article7_notification',
      'scip_notification', 'authority_response')
    OR (external_reference IS NOT NULL AND evidence_document_id IS NOT NULL
      AND evidence_sha256 IS NOT NULL AND evidence_file_size_bytes IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_reach_obligation_events_dossier
  ON public.reach_obligation_events(company_id, shipment_id, dossier_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_reach_obligation_events_due
  ON public.reach_obligation_events(company_id, response_due_at) WHERE response_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reach_obligation_events_evidence ON public.reach_obligation_events(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_reach_obligation_events_recorded_by ON public.reach_obligation_events(recorded_by);

CREATE OR REPLACE FUNCTION public.reject_reach_record_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REACH dossiers, reviews and obligation events are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_reach_svhc_dossiers_immutable ON public.reach_svhc_dossier_revisions;
CREATE TRIGGER trg_reach_svhc_dossiers_immutable BEFORE UPDATE OR DELETE ON public.reach_svhc_dossier_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_reach_record_mutation();
DROP TRIGGER IF EXISTS trg_reach_svhc_reviews_immutable ON public.reach_svhc_dossier_reviews;
CREATE TRIGGER trg_reach_svhc_reviews_immutable BEFORE UPDATE OR DELETE ON public.reach_svhc_dossier_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_reach_record_mutation();
DROP TRIGGER IF EXISTS trg_reach_obligation_events_immutable ON public.reach_obligation_events;
CREATE TRIGGER trg_reach_obligation_events_immutable BEFORE UPDATE OR DELETE ON public.reach_obligation_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_reach_record_mutation();
