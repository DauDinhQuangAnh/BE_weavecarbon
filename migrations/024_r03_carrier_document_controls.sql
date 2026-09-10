-- R03 carrier-issued transport-document metadata, reconciliation and Carbon Annex provenance.
-- WeaveCarbon stores the carrier file and confirmed metadata; it never issues the legal transport document.

ALTER TABLE public.shipment_export_lines
  ADD COLUMN IF NOT EXISTS carbon_snapshot_id UUID REFERENCES public.product_assessment_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carbon_snapshot_version INTEGER,
  ADD COLUMN IF NOT EXISTS carbon_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS carbon_methodology_version TEXT,
  ADD COLUMN IF NOT EXISTS carbon_factor_registry_version TEXT,
  ADD COLUMN IF NOT EXISTS carbon_gwp_basis TEXT,
  ADD COLUMN IF NOT EXISTS carbon_boundary TEXT,
  ADD COLUMN IF NOT EXISTS carbon_canonical_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS carbon_factor_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS carbon_allocation_method TEXT;

ALTER TABLE public.shipment_export_lines
  DROP CONSTRAINT IF EXISTS chk_export_line_carbon_snapshot_version;
ALTER TABLE public.shipment_export_lines
  ADD CONSTRAINT chk_export_line_carbon_snapshot_version
  CHECK (carbon_snapshot_version IS NULL OR carbon_snapshot_version > 0);

ALTER TABLE public.shipment_export_lines
  DROP CONSTRAINT IF EXISTS chk_export_line_carbon_hash;
ALTER TABLE public.shipment_export_lines
  ADD CONSTRAINT chk_export_line_carbon_hash
  CHECK (carbon_canonical_input_hash IS NULL OR carbon_canonical_input_hash ~* '^[a-f0-9]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_documents_tenant_shipment_id
  ON public.evidence_documents(company_id, shipment_id, id);

CREATE TABLE IF NOT EXISTS public.shipment_carrier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  evidence_document_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('bill_of_lading', 'fbl', 'air_waybill', 'cmr', 'cim')),
  contract_level TEXT NOT NULL DEFAULT 'direct' CHECK (contract_level IN ('master', 'house', 'direct')),
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('sea', 'air', 'road', 'rail', 'multimodal')),
  document_number TEXT NOT NULL CHECK (length(trim(document_number)) > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'superseded', 'rejected')),
  issuer_name TEXT NOT NULL DEFAULT '',
  issuer_identifier TEXT,
  issue_date DATE,
  issue_place TEXT,
  on_board_date DATE,
  shipper JSONB NOT NULL DEFAULT '{}'::jsonb,
  consignee JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_party JSONB NOT NULL DEFAULT '{}'::jsonb,
  vessel_name TEXT,
  voyage_number TEXT,
  flight_number TEXT,
  vehicle_registration TEXT,
  train_number TEXT,
  place_of_receipt TEXT,
  place_of_loading TEXT,
  place_of_discharge TEXT,
  place_of_delivery TEXT,
  goods_description TEXT,
  package_count INTEGER CHECK (package_count IS NULL OR package_count > 0),
  package_type TEXT,
  marks_and_numbers TEXT,
  gross_weight_kg NUMERIC(18, 4) CHECK (gross_weight_kg IS NULL OR gross_weight_kg > 0),
  measurement_cbm NUMERIC(18, 6) CHECK (measurement_cbm IS NULL OR measurement_cbm >= 0),
  container_numbers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(container_numbers) = 'array'),
  seal_numbers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(seal_numbers) = 'array'),
  freight_terms TEXT CHECK (freight_terms IS NULL OR freight_terms IN ('prepaid', 'collect', 'other')),
  payment_terms TEXT,
  authentication_method TEXT,
  authentication_reference TEXT,
  authenticity_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (authenticity_status IN ('unverified', 'operator_confirmed', 'issuer_verified', 'rejected')),
  original_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (original_status IN ('original', 'copy', 'electronic', 'sea_waybill', 'non_negotiable', 'unknown')),
  negotiable BOOLEAN,
  metadata_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (metadata_source IN ('manual', 'ocr_confirmed', 'carrier_api')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  supersedes_id UUID,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  metadata_confirmed_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  metadata_confirmer_name_snapshot TEXT,
  metadata_confirmer_email_snapshot TEXT,
  metadata_confirmation_note TEXT,
  metadata_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id, shipment_id),
  UNIQUE(evidence_document_id),
  UNIQUE(shipment_id, document_type, document_number, version),
  FOREIGN KEY (company_id, shipment_id, evidence_document_id)
    REFERENCES public.evidence_documents(company_id, shipment_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id, company_id, shipment_id)
    REFERENCES public.shipment_carrier_documents(id, company_id, shipment_id) ON DELETE RESTRICT,
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CHECK (
    (status = 'draft' AND metadata_confirmed_by IS NULL AND metadata_confirmed_at IS NULL
      AND metadata_confirmer_name_snapshot IS NULL)
    OR
    (status IN ('confirmed', 'superseded', 'rejected') AND metadata_confirmed_by IS NOT NULL
      AND metadata_confirmed_at IS NOT NULL
      AND length(trim(metadata_confirmer_name_snapshot)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_shipment_carrier_documents_current
  ON public.shipment_carrier_documents(company_id, shipment_id, status, document_type, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_carrier_documents_active_identity
  ON public.shipment_carrier_documents(company_id, shipment_id, document_type, upper(trim(document_number)))
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS public.carrier_document_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  carrier_document_id UUID NOT NULL,
  ruleset_version TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK (source_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  checks JSONB NOT NULL CHECK (jsonb_typeof(checks) = 'array'),
  reconciled_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reconciler_name_snapshot TEXT NOT NULL CHECK (length(trim(reconciler_name_snapshot)) > 0),
  reconciler_email_snapshot TEXT,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (carrier_document_id, company_id, shipment_id)
    REFERENCES public.shipment_carrier_documents(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_carrier_document_reconciliations_latest
  ON public.carrier_document_reconciliations(company_id, shipment_id, carrier_document_id, reconciled_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_confirmed_carrier_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Confirmed carrier document metadata is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'confirmed' AND NEW.status IN ('superseded', 'rejected')) THEN
        RAISE EXCEPTION 'Carrier document lifecycle transition is not permitted';
      END IF;
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
       OR NEW.evidence_document_id IS DISTINCT FROM OLD.evidence_document_id
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.contract_level IS DISTINCT FROM OLD.contract_level
       OR NEW.transport_mode IS DISTINCT FROM OLD.transport_mode
       OR NEW.document_number IS DISTINCT FROM OLD.document_number
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.issuer_name IS DISTINCT FROM OLD.issuer_name
       OR NEW.issuer_identifier IS DISTINCT FROM OLD.issuer_identifier
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.issue_place IS DISTINCT FROM OLD.issue_place
       OR NEW.on_board_date IS DISTINCT FROM OLD.on_board_date
       OR NEW.shipper IS DISTINCT FROM OLD.shipper
       OR NEW.consignee IS DISTINCT FROM OLD.consignee
       OR NEW.notify_party IS DISTINCT FROM OLD.notify_party
       OR NEW.vessel_name IS DISTINCT FROM OLD.vessel_name
       OR NEW.voyage_number IS DISTINCT FROM OLD.voyage_number
       OR NEW.flight_number IS DISTINCT FROM OLD.flight_number
       OR NEW.vehicle_registration IS DISTINCT FROM OLD.vehicle_registration
       OR NEW.train_number IS DISTINCT FROM OLD.train_number
       OR NEW.place_of_receipt IS DISTINCT FROM OLD.place_of_receipt
       OR NEW.place_of_loading IS DISTINCT FROM OLD.place_of_loading
       OR NEW.place_of_discharge IS DISTINCT FROM OLD.place_of_discharge
       OR NEW.place_of_delivery IS DISTINCT FROM OLD.place_of_delivery
       OR NEW.goods_description IS DISTINCT FROM OLD.goods_description
       OR NEW.package_count IS DISTINCT FROM OLD.package_count
       OR NEW.package_type IS DISTINCT FROM OLD.package_type
       OR NEW.marks_and_numbers IS DISTINCT FROM OLD.marks_and_numbers
       OR NEW.gross_weight_kg IS DISTINCT FROM OLD.gross_weight_kg
       OR NEW.measurement_cbm IS DISTINCT FROM OLD.measurement_cbm
       OR NEW.container_numbers IS DISTINCT FROM OLD.container_numbers
       OR NEW.seal_numbers IS DISTINCT FROM OLD.seal_numbers
       OR NEW.freight_terms IS DISTINCT FROM OLD.freight_terms
       OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
       OR NEW.authentication_method IS DISTINCT FROM OLD.authentication_method
       OR NEW.authentication_reference IS DISTINCT FROM OLD.authentication_reference
       OR NEW.authenticity_status IS DISTINCT FROM OLD.authenticity_status
       OR NEW.original_status IS DISTINCT FROM OLD.original_status
       OR NEW.negotiable IS DISTINCT FROM OLD.negotiable
       OR NEW.metadata_source IS DISTINCT FROM OLD.metadata_source
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
       OR NEW.metadata_confirmed_by IS DISTINCT FROM OLD.metadata_confirmed_by
       OR NEW.metadata_confirmer_name_snapshot IS DISTINCT FROM OLD.metadata_confirmer_name_snapshot
       OR NEW.metadata_confirmer_email_snapshot IS DISTINCT FROM OLD.metadata_confirmer_email_snapshot
       OR NEW.metadata_confirmation_note IS DISTINCT FROM OLD.metadata_confirmation_note
       OR NEW.metadata_confirmed_at IS DISTINCT FROM OLD.metadata_confirmed_at THEN
      RAISE EXCEPTION 'Confirmed carrier document metadata is immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_carrier_documents_immutable ON public.shipment_carrier_documents;
CREATE TRIGGER trg_shipment_carrier_documents_immutable
BEFORE UPDATE OR DELETE ON public.shipment_carrier_documents
FOR EACH ROW EXECUTE FUNCTION public.reject_confirmed_carrier_document_mutation();

CREATE OR REPLACE FUNCTION public.reject_carrier_reconciliation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Carrier document reconciliation records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_carrier_document_reconciliations_append_only ON public.carrier_document_reconciliations;
CREATE TRIGGER trg_carrier_document_reconciliations_append_only
BEFORE UPDATE OR DELETE ON public.carrier_document_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.reject_carrier_reconciliation_mutation();
