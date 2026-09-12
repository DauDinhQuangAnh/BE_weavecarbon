-- R07 EVFTA preferential-origin evidence/calculation handoff.
-- This migration does not create a proof of origin, EUR.1 or customs preference decision.

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_document_type_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_document_type_check
  CHECK (document_type IN (
    'commercial_invoice', 'packing_list', 'vn_customs_handoff', 'eu_import_handoff',
    'ics2_dataset', 'origin_workbook'
  ));

ALTER TABLE public.export_document_reviews
  DROP CONSTRAINT IF EXISTS export_document_reviews_reviewer_role_check;
ALTER TABLE public.export_document_reviews
  ADD CONSTRAINT export_document_reviews_reviewer_role_check
  CHECK (reviewer_role IN (
    'export_operator', 'warehouse_reviewer', 'customs_declaration_reviewer',
    'eu_import_declaration_reviewer', 'ics2_filing_reviewer', 'origin_specialist_reviewer'
  ));

CREATE TABLE IF NOT EXISTS public.shipment_origin_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  schema_id TEXT NOT NULL DEFAULT 'weavecarbon.evfta-origin-support-handoff',
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  ruleset_version TEXT NOT NULL DEFAULT 'R07-EVFTA-ORIGIN-2026.09.1',
  regulatory_basis_version TEXT NOT NULL DEFAULT 'EVFTA-PROTOCOL-1-ART2-6+12-16+ANNEX-II@OJ-L186-2020',
  handoff_purpose TEXT NOT NULL DEFAULT 'origin_specialist_review'
    CHECK (handoff_purpose = 'origin_specialist_review'),
  claim_type TEXT NOT NULL CHECK (claim_type IN ('certificate_application', 'origin_declaration_draft')),
  invoice_total_eur NUMERIC(18, 4) CHECK (invoice_total_eur IS NULL OR invoice_total_eur >= 0),
  exporter_authorization_type TEXT NOT NULL DEFAULT 'none'
    CHECK (exporter_authorization_type IN ('none', 'approved', 'registered')),
  exporter_authorization_reference TEXT,
  territoriality_confirmed BOOLEAN NOT NULL DEFAULT false,
  non_alteration_confirmed BOOLEAN NOT NULL DEFAULT false,
  insufficient_processing_excluded BOOLEAN NOT NULL DEFAULT false,
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile_data) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_origin_profiles_tenant
  ON public.shipment_origin_profiles(company_id, shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipment_origin_profiles_created_by
  ON public.shipment_origin_profiles(created_by);

CREATE INDEX IF NOT EXISTS idx_shipment_origin_profiles_updated_by
  ON public.shipment_origin_profiles(updated_by);
