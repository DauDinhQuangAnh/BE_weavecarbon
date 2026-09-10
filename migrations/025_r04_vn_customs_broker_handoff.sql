-- R04 Vietnam export customs broker-handoff dataset and evidence-backed external response lifecycle.
-- This migration does not add a VNACCS submission client and never infers authority acceptance.

ALTER TABLE public.export_documents
  DROP CONSTRAINT IF EXISTS export_documents_document_type_check;
ALTER TABLE public.export_documents
  ADD CONSTRAINT export_documents_document_type_check CHECK (document_type IN (
    'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset',
    'vn_customs_handoff'
  ));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_document_type_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_document_type_check
  CHECK (document_type IN ('commercial_invoice', 'packing_list', 'vn_customs_handoff'));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_reviewer_role_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_reviewer_role_check
  CHECK (reviewer_role IN ('export_operator', 'warehouse_reviewer', 'customs_declaration_reviewer'));

CREATE TABLE IF NOT EXISTS public.shipment_vn_customs_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL DEFAULT 'weavecarbon.vn-export-broker-handoff',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ruleset_version TEXT NOT NULL DEFAULT 'R04-VN-CUSTOMS-HANDOFF-2026.09.1',
  regulatory_basis_version TEXT NOT NULL DEFAULT 'TT38/2015+TT39/2018+TT121/2025@2026-02-01',
  filing_purpose TEXT NOT NULL DEFAULT 'broker_handoff' CHECK (filing_purpose = 'broker_handoff'),
  declarant JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(declarant) = 'object'),
  customs_broker JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(customs_broker) = 'object'),
  customs_office_code TEXT,
  declaration_type_code TEXT,
  cargo_classification_code TEXT,
  transport_method_code TEXT,
  exit_customs_office_code TEXT,
  loading_location_code TEXT,
  destination_country_code TEXT,
  invoice_classification_code TEXT,
  invoice_payment_method_code TEXT,
  exchange_rate NUMERIC(20, 6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  permit_requirement_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (permit_requirement_status IN ('unknown', 'not_required', 'required')),
  permit_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permit_references) = 'array'),
  inspection_requirement_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (inspection_requirement_status IN ('unknown', 'not_required', 'required')),
  inspection_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inspection_references) = 'array'),
  tax_treatment TEXT NOT NULL DEFAULT 'unknown'
    CHECK (tax_treatment IN ('unknown', 'not_subject', 'exempt', 'taxable')),
  export_duty_rate NUMERIC(12, 6) CHECK (export_duty_rate IS NULL OR export_duty_rate >= 0),
  export_duty_amount NUMERIC(20, 4) CHECK (export_duty_amount IS NULL OR export_duty_amount >= 0),
  tax_basis TEXT,
  supporting_documents JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_documents) = 'array'),
  broker_target_schema_id TEXT,
  broker_target_schema_version TEXT,
  declaration_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_vn_customs_profiles_tenant
  ON public.shipment_vn_customs_profiles(company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.vn_customs_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  export_document_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'broker_received', 'broker_validated', 'broker_rejected',
    'authority_submitted', 'authority_accepted', 'authority_rejected',
    'authority_released', 'authority_cancelled',
    'amendment_requested', 'amendment_submitted'
  )),
  source_type TEXT NOT NULL CHECK (source_type IN ('broker', 'authority')),
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
      'authority_accepted', 'authority_rejected', 'authority_released', 'authority_cancelled'
    )) OR
    (source_type = 'broker' AND event_type IN (
      'broker_received', 'broker_validated', 'broker_rejected', 'authority_submitted',
      'amendment_requested', 'amendment_submitted'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_vn_customs_external_events_latest
  ON public.vn_customs_external_events(company_id, shipment_id, occurred_at DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_vn_customs_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Vietnam customs external events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_vn_customs_external_events_append_only ON public.vn_customs_external_events;
CREATE TRIGGER trg_vn_customs_external_events_append_only
BEFORE UPDATE OR DELETE ON public.vn_customs_external_events
FOR EACH ROW EXECUTE FUNCTION public.reject_vn_customs_event_mutation();
