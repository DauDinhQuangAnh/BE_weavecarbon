-- Shipment-scoped export workflow. Additive and safe for existing records.

CREATE TABLE IF NOT EXISTS public.shipment_export_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  target_market TEXT NOT NULL DEFAULT 'EU',
  invoice_number TEXT,
  invoice_date DATE,
  po_contract_id TEXT,
  incoterm_code TEXT,
  incoterm_location TEXT,
  incoterm_version TEXT DEFAULT 'Incoterms 2020',
  currency TEXT,
  payment_terms TEXT,
  exporter JSONB NOT NULL DEFAULT '{}'::jsonb,
  importer JSONB NOT NULL DEFAULT '{}'::jsonb,
  consignee JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_party JSONB NOT NULL DEFAULT '{}'::jsonb,
  exporter_tax_id TEXT,
  importer_eori TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  place_of_delivery TEXT,
  vessel_name TEXT,
  voyage_number TEXT,
  bill_of_lading_no TEXT,
  container_no TEXT,
  seal_no TEXT,
  customs_declaration_no TEXT,
  freight_amount NUMERIC(18, 4),
  insurance_amount NUMERIC(18, 4),
  preferential_origin_claim BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_export_profiles_company
  ON public.shipment_export_profiles(company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.shipment_export_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  source_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  sku TEXT NOT NULL,
  goods_description TEXT NOT NULL,
  hs_code TEXT NOT NULL,
  origin_country TEXT NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_price NUMERIC(18, 6),
  currency TEXT,
  net_weight_kg NUMERIC(18, 4),
  gross_weight_kg NUMERIC(18, 4),
  embedded_co2e_kg NUMERIC(18, 6),
  package_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_shipment_export_lines_company
  ON public.shipment_export_lines(company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.shipment_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  package_number TEXT NOT NULL,
  package_type TEXT NOT NULL,
  marks_and_numbers TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  net_weight_kg NUMERIC(18, 4),
  gross_weight_kg NUMERIC(18, 4),
  length_cm NUMERIC(12, 3),
  width_cm NUMERIC(12, 3),
  height_cm NUMERIC(12, 3),
  contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, package_number)
);

CREATE INDEX IF NOT EXISTS idx_shipment_packages_company
  ON public.shipment_packages(company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.export_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'commercial_invoice', 'packing_list', 'carbon_annex', 'origin_workbook', 'ics2_dataset'
  )),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'blocked', 'ready', 'issued', 'superseded', 'failed'
  )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 TEXT,
  file_sha256 TEXT,
  storage_provider TEXT,
  storage_key TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  supersedes_id UUID REFERENCES public.export_documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  issued_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, document_type, version)
);

CREATE INDEX IF NOT EXISTS idx_export_documents_company_shipment
  ON public.export_documents(company_id, shipment_id, document_type, version DESC);
CREATE INDEX IF NOT EXISTS idx_export_documents_report ON public.export_documents(report_id);

CREATE OR REPLACE FUNCTION public.reject_issued_export_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('issued', 'superseded') THEN
    RAISE EXCEPTION 'Issued export documents are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('issued', 'superseded') THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
       OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
       OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
       OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
       OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Issued export document content is immutable';
    END IF;
    IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Superseded export documents cannot change status';
    END IF;
    IF OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'superseded') THEN
      RAISE EXCEPTION 'Issued export documents may only become superseded';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_export_documents_immutable ON public.export_documents;
CREATE TRIGGER trg_export_documents_immutable
BEFORE UPDATE OR DELETE ON public.export_documents
FOR EACH ROW EXECUTE FUNCTION public.reject_issued_export_document_mutation();

CREATE TABLE IF NOT EXISTS public.export_requirement_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  requirement_code TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  applicable BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL CHECK (status IN ('missing', 'invalid', 'ready', 'not_applicable')),
  field_path TEXT,
  message TEXT,
  evidence_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, document_type, requirement_code, ruleset_version)
);

CREATE INDEX IF NOT EXISTS idx_export_requirement_results_company
  ON public.export_requirement_results(company_id, shipment_id, status);

ALTER TABLE public.evidence_documents
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_to DATE,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

ALTER TABLE public.dpp_locks DROP CONSTRAINT IF EXISTS dpp_locks_status_check;
ALTER TABLE public.dpp_locks
  ADD CONSTRAINT dpp_locks_status_check CHECK (status IN ('prototype', 'locked', 'revoked'));
ALTER TABLE public.dpp_locks ALTER COLUMN status SET DEFAULT 'prototype';
