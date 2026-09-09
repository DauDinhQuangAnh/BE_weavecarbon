-- Additive R01/R02 business-review and measurement-semantics controls.

ALTER TABLE public.shipment_export_profiles
  ADD COLUMN IF NOT EXISTS importer_vat_id TEXT,
  ADD COLUMN IF NOT EXISTS carrier_name TEXT,
  ADD COLUMN IF NOT EXISTS customs_value_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS customs_value_basis TEXT;

ALTER TABLE public.shipment_export_profiles
  DROP CONSTRAINT IF EXISTS chk_export_profile_customs_value_nonnegative;
ALTER TABLE public.shipment_export_profiles
  ADD CONSTRAINT chk_export_profile_customs_value_nonnegative
  CHECK (customs_value_amount IS NULL OR customs_value_amount >= 0);

ALTER TABLE public.shipment_export_lines
  ADD COLUMN IF NOT EXISTS hs_code_source TEXT,
  ADD COLUMN IF NOT EXISTS hs_code_ruleset TEXT,
  ADD COLUMN IF NOT EXISTS hs_code_effective_date DATE;

ALTER TABLE public.shipment_packages
  ADD COLUMN IF NOT EXISTS weight_measurement_basis TEXT NOT NULL DEFAULT 'per_package',
  ADD COLUMN IF NOT EXISTS dimension_measurement_basis TEXT NOT NULL DEFAULT 'per_package';

ALTER TABLE public.shipment_packages
  DROP CONSTRAINT IF EXISTS chk_shipment_packages_weight_basis;
ALTER TABLE public.shipment_packages
  ADD CONSTRAINT chk_shipment_packages_weight_basis
  CHECK (weight_measurement_basis IN ('per_package', 'group_total'));

ALTER TABLE public.shipment_packages
  DROP CONSTRAINT IF EXISTS chk_shipment_packages_dimension_basis;
ALTER TABLE public.shipment_packages
  ADD CONSTRAINT chk_shipment_packages_dimension_basis
  CHECK (dimension_measurement_basis IN ('per_package', 'group_total'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_export_documents_tenant_identity
  ON public.export_documents(id, company_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.export_document_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  export_document_id UUID NOT NULL REFERENCES public.export_documents(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('commercial_invoice', 'packing_list')),
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('export_operator', 'warehouse_reviewer')),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  notes TEXT,
  document_payload_sha256 TEXT NOT NULL CHECK (document_payload_sha256 ~* '^[a-f0-9]{64}$'),
  document_file_sha256 TEXT NOT NULL CHECK (document_file_sha256 ~* '^[a-f0-9]{64}$'),
  source_snapshot_sha256 TEXT NOT NULL CHECK (source_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  reviewed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (export_document_id, company_id, shipment_id)
    REFERENCES public.export_documents(id, company_id, shipment_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_export_document_reviews_latest
  ON public.export_document_reviews(company_id, shipment_id, export_document_id, reviewed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_export_document_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Export document review records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_export_document_reviews_append_only ON public.export_document_reviews;
CREATE TRIGGER trg_export_document_reviews_append_only
BEFORE UPDATE OR DELETE ON public.export_document_reviews
FOR EACH ROW EXECUTE FUNCTION public.reject_export_document_review_mutation();
