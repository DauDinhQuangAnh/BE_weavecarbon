-- R05 EU import declarant-handoff dataset and evidence-backed external lifecycle.
-- This migration does not add a national customs submission client and never infers authority acceptance.

ALTER TABLE public.export_documents
  DROP CONSTRAINT IF EXISTS export_documents_document_type_check;
ALTER TABLE public.export_documents
  ADD CONSTRAINT export_documents_document_type_check CHECK (document_type IN (
    'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset',
    'vn_customs_handoff', 'eu_import_handoff'
  ));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_document_type_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_document_type_check
  CHECK (document_type IN ('commercial_invoice', 'packing_list', 'vn_customs_handoff', 'eu_import_handoff'));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_reviewer_role_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_reviewer_role_check
  CHECK (reviewer_role IN (
    'export_operator', 'warehouse_reviewer', 'customs_declaration_reviewer', 'eu_import_declaration_reviewer'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_export_lines_tenant_identity
  ON public.shipment_export_lines(id, company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.shipment_eu_import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL DEFAULT 'weavecarbon.eu-import-declarant-handoff',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ruleset_version TEXT NOT NULL DEFAULT 'R05-EU-IMPORT-HANDOFF-2026.09.1',
  regulatory_basis_version TEXT NOT NULL DEFAULT 'UCC-DA-2015/2446-ANNEX-B+UCC-IA-2015/2447-ANNEX-B@EUCDM-7.0.11',
  filing_purpose TEXT NOT NULL DEFAULT 'declarant_handoff' CHECK (filing_purpose = 'declarant_handoff'),
  member_state_code TEXT,
  importer JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(importer) = 'object'),
  declarant JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(declarant) = 'object'),
  representative JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(representative) = 'object'),
  representation_type TEXT NOT NULL DEFAULT 'none'
    CHECK (representation_type IN ('none', 'direct', 'indirect')),
  customs_office_code TEXT,
  declaration_dataset_code TEXT,
  additional_declaration_type TEXT,
  requested_procedure_code TEXT,
  previous_procedure_code TEXT,
  mode_of_transport_at_border TEXT,
  inland_mode_of_transport TEXT,
  border_transport_identity TEXT,
  place_of_goods_code TEXT,
  delivery_terms_location TEXT,
  valuation_method_code TEXT,
  exchange_rate NUMERIC(20, 6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  customs_value_currency TEXT,
  customs_value_amount NUMERIC(20, 4) CHECK (customs_value_amount IS NULL OR customs_value_amount >= 0),
  duty_treatment TEXT NOT NULL DEFAULT 'unknown'
    CHECK (duty_treatment IN ('unknown', 'not_subject', 'exempt', 'payable')),
  duty_rate NUMERIC(12, 6) CHECK (duty_rate IS NULL OR duty_rate >= 0),
  duty_amount NUMERIC(20, 4) CHECK (duty_amount IS NULL OR duty_amount >= 0),
  vat_treatment TEXT NOT NULL DEFAULT 'unknown'
    CHECK (vat_treatment IN ('unknown', 'not_subject', 'exempt', 'payable')),
  vat_rate NUMERIC(12, 6) CHECK (vat_rate IS NULL OR vat_rate >= 0),
  vat_amount NUMERIC(20, 4) CHECK (vat_amount IS NULL OR vat_amount >= 0),
  tax_basis TEXT,
  restriction_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (restriction_status IN ('unknown', 'not_required', 'required')),
  restriction_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(restriction_references) = 'array'),
  preference_claim_status TEXT NOT NULL DEFAULT 'no_claim'
    CHECK (preference_claim_status IN ('no_claim', 'claimed')),
  preference_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preference_references) = 'array'),
  guarantee_requirement_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (guarantee_requirement_status IN ('unknown', 'not_required', 'required')),
  guarantee_references JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(guarantee_references) = 'array'),
  supporting_documents JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_documents) = 'array'),
  target_system_schema_id TEXT,
  target_system_schema_version TEXT,
  declaration_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_eu_import_profiles_tenant
  ON public.shipment_eu_import_profiles(company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.shipment_eu_import_line_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  export_line_id UUID NOT NULL,
  taric_code TEXT,
  taric_source TEXT,
  taric_version TEXT,
  taric_effective_date DATE,
  taric_confirmed BOOLEAN NOT NULL DEFAULT false,
  taric_confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  taric_confirmed_at TIMESTAMPTZ,
  supplementary_unit_code TEXT,
  additional_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(additional_codes) = 'array'),
  national_additional_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(national_additional_codes) = 'array'),
  preference_code TEXT,
  requested_procedure_code TEXT,
  previous_procedure_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, export_line_id),
  FOREIGN KEY (export_line_id, company_id, shipment_id)
    REFERENCES public.shipment_export_lines(id, company_id, shipment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipment_eu_import_line_details_tenant
  ON public.shipment_eu_import_line_details(company_id, shipment_id, export_line_id);

CREATE TABLE IF NOT EXISTS public.eu_import_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  export_document_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'declarant_received', 'declarant_validated', 'declarant_rejected',
    'authority_submitted', 'authority_accepted', 'authority_rejected',
    'authority_released', 'authority_cancelled',
    'amendment_requested', 'amendment_submitted'
  )),
  source_type TEXT NOT NULL CHECK (source_type IN ('declarant', 'authority')),
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
    (source_type = 'declarant' AND event_type IN (
      'declarant_received', 'declarant_validated', 'declarant_rejected', 'authority_submitted',
      'amendment_requested', 'amendment_submitted'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_eu_import_external_events_latest
  ON public.eu_import_external_events(company_id, shipment_id, occurred_at DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_eu_import_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EU import external events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_eu_import_external_events_append_only ON public.eu_import_external_events;
CREATE TRIGGER trg_eu_import_external_events_append_only
BEFORE UPDATE OR DELETE ON public.eu_import_external_events
FOR EACH ROW EXECUTE FUNCTION public.reject_eu_import_event_mutation();
