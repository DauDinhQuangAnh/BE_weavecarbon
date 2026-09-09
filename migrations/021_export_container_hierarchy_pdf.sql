-- Additive R01/R02 container hierarchy and output-format support.

CREATE TABLE IF NOT EXISTS public.shipment_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  container_number TEXT NOT NULL,
  seal_number TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  marks_and_numbers TEXT,
  tare_weight_kg NUMERIC(18, 4),
  max_gross_weight_kg NUMERIC(18, 4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, container_number),
  UNIQUE(id, company_id, shipment_id),
  CHECK (tare_weight_kg IS NULL OR tare_weight_kg >= 0),
  CHECK (max_gross_weight_kg IS NULL OR max_gross_weight_kg > 0)
);

CREATE INDEX IF NOT EXISTS idx_shipment_containers_company
  ON public.shipment_containers(company_id, shipment_id, container_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_packages_tenant_identity
  ON public.shipment_packages(id, company_id, shipment_id);

ALTER TABLE public.shipment_packages
  ADD COLUMN IF NOT EXISTS container_id UUID,
  ADD COLUMN IF NOT EXISTS parent_package_id UUID,
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shipment_packages_container_tenant'
  ) THEN
    ALTER TABLE public.shipment_packages
      ADD CONSTRAINT fk_shipment_packages_container_tenant
      FOREIGN KEY (container_id, company_id, shipment_id)
      REFERENCES public.shipment_containers(id, company_id, shipment_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_shipment_packages_parent_tenant'
  ) THEN
    ALTER TABLE public.shipment_packages
      ADD CONSTRAINT fk_shipment_packages_parent_tenant
      FOREIGN KEY (parent_package_id, company_id, shipment_id)
      REFERENCES public.shipment_packages(id, company_id, shipment_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_shipment_packages_not_self_parent'
  ) THEN
    ALTER TABLE public.shipment_packages
      ADD CONSTRAINT chk_shipment_packages_not_self_parent
      CHECK (parent_package_id IS NULL OR parent_package_id <> id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_shipment_packages_sequence_positive'
  ) THEN
    ALTER TABLE public.shipment_packages
      ADD CONSTRAINT chk_shipment_packages_sequence_positive
      CHECK (sequence_no IS NULL OR sequence_no > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipment_packages_hierarchy
  ON public.shipment_packages(company_id, shipment_id, container_id, parent_package_id, sequence_no);

ALTER TABLE public.export_documents
  ADD COLUMN IF NOT EXISTS output_format TEXT;

UPDATE public.export_documents
SET output_format = CASE WHEN document_type = 'ics2_dataset' THEN 'csv' ELSE 'xlsx' END
WHERE output_format IS NULL;

ALTER TABLE public.export_documents
  ALTER COLUMN output_format SET DEFAULT 'xlsx',
  ALTER COLUMN output_format SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_export_documents_output_format'
  ) THEN
    ALTER TABLE public.export_documents
      ADD CONSTRAINT chk_export_documents_output_format
      CHECK (output_format IN ('xlsx', 'pdf', 'csv'));
  END IF;
END $$;

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
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.output_format IS DISTINCT FROM OLD.output_format
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
