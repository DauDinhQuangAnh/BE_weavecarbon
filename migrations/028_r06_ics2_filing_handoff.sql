-- R06 ICS2 filing-handoff profile, master/house consignment model and evidence-backed lifecycle.
-- This migration does not add an ICS2/STI client and never infers ENS registration or customs acceptance.

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_document_type_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_document_type_check
  CHECK (document_type IN (
    'commercial_invoice', 'packing_list', 'vn_customs_handoff', 'eu_import_handoff', 'ics2_dataset'
  ));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_reviewer_role_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_reviewer_role_check
  CHECK (reviewer_role IN (
    'export_operator', 'warehouse_reviewer', 'customs_declaration_reviewer',
    'eu_import_declaration_reviewer', 'ics2_filing_reviewer'
  ));

CREATE TABLE IF NOT EXISTS public.shipment_ics2_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL DEFAULT 'weavecarbon.ics2-filing-handoff',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ruleset_version TEXT NOT NULL DEFAULT 'R06-ICS2-FILING-HANDOFF-2026.09.1',
  regulatory_basis_version TEXT NOT NULL DEFAULT 'UCC-952/2013-ART127+UCC-DA-2015/2446-ANNEX-B+EU-2026/1022@2026-09-12',
  filing_purpose TEXT NOT NULL DEFAULT 'filer_handoff' CHECK (filing_purpose = 'filer_handoff'),
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('sea', 'inland_waterway', 'air', 'road', 'rail')),
  message_dataset_code TEXT NOT NULL CHECK (message_dataset_code ~ '^F(1[0-6]|2[0-9]|3[0-4]|4[0-5]|5[01])$'),
  filing_role TEXT NOT NULL CHECK (filing_role IN (
    'carrier', 'house_level_filer', 'express_carrier', 'postal_operator', 'representative'
  )),
  filing_arrangement TEXT NOT NULL DEFAULT 'single' CHECK (filing_arrangement IN ('single', 'multiple')),
  local_reference_number TEXT NOT NULL CHECK (length(trim(local_reference_number)) > 0),
  target_system_schema_id TEXT NOT NULL CHECK (length(trim(target_system_schema_id)) > 0),
  target_system_schema_version TEXT NOT NULL CHECK (length(trim(target_system_schema_version)) > 0),
  technical_package_id TEXT NOT NULL CHECK (length(trim(technical_package_id)) > 0),
  technical_package_version TEXT NOT NULL CHECK (length(trim(technical_package_version)) > 0),
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile_data) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_ics2_profiles_tenant
  ON public.shipment_ics2_profiles(company_id, shipment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_ics2_profiles_company_lrn
  ON public.shipment_ics2_profiles(company_id, local_reference_number);

CREATE TABLE IF NOT EXISTS public.ics2_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  export_document_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'filer_received', 'filer_validated', 'filer_rejected',
    'authority_registered', 'authority_rejected', 'risk_referral', 'do_not_load',
    'assessment_complete', 'amendment_requested', 'amendment_registered',
    'invalidation_requested', 'invalidated'
  )),
  source_type TEXT NOT NULL CHECK (source_type IN ('filer', 'authority')),
  external_reference TEXT NOT NULL CHECK (length(trim(external_reference)) > 0),
  message_code TEXT,
  message_text TEXT,
  evidence_document_id UUID NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_file_size_bytes BIGINT NOT NULL CHECK (evidence_file_size_bytes > 0),
  document_payload_sha256 TEXT NOT NULL CHECK (document_payload_sha256 ~* '^[a-f0-9]{64}$'),
  document_file_sha256 TEXT NOT NULL CHECK (document_file_sha256 ~* '^[a-f0-9]{64}$'),
  actor_name_snapshot TEXT NOT NULL CHECK (length(trim(actor_name_snapshot)) > 0),
  actor_identifier_snapshot TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorder_name_snapshot TEXT NOT NULL CHECK (length(trim(recorder_name_snapshot)) > 0),
  recorder_email_snapshot TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (export_document_id, company_id, shipment_id)
    REFERENCES public.export_documents(id, company_id, shipment_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, shipment_id, evidence_document_id)
    REFERENCES public.evidence_documents(company_id, shipment_id, id) ON DELETE RESTRICT,
  CHECK (
    (source_type = 'authority' AND event_type IN (
      'authority_registered', 'authority_rejected', 'risk_referral', 'do_not_load',
      'assessment_complete', 'amendment_registered', 'invalidated'
    )) OR
    (source_type = 'filer' AND event_type IN (
      'filer_received', 'filer_validated', 'filer_rejected',
      'amendment_requested', 'invalidation_requested'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_ics2_external_events_latest
  ON public.ics2_external_events(company_id, shipment_id, occurred_at DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_ics2_external_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ICS2 external events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_ics2_external_events_append_only ON public.ics2_external_events;
CREATE TRIGGER trg_ics2_external_events_append_only
BEFORE UPDATE OR DELETE ON public.ics2_external_events
FOR EACH ROW EXECUTE FUNCTION public.reject_ics2_external_event_mutation();
