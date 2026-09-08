-- Immutable, tenant-scoped internal-review Audit Pack bundles.

CREATE TABLE IF NOT EXISTS public.audit_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  calculation_snapshot_id UUID NOT NULL REFERENCES public.product_assessment_snapshots(id) ON DELETE RESTRICT,
  report_id UUID NOT NULL UNIQUE REFERENCES public.reports(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  assurance_status TEXT NOT NULL DEFAULT 'not_verified' CHECK (assurance_status = 'not_verified'),
  manifest JSONB,
  manifest_sha256 TEXT,
  bundle_sha256 TEXT,
  storage_provider TEXT,
  storage_key TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  error_message TEXT,
  supersedes_id UUID REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, version)
);

CREATE INDEX IF NOT EXISTS idx_audit_bundles_company_product
  ON public.audit_bundles(company_id, product_id, version DESC);

CREATE TABLE IF NOT EXISTS public.audit_bundle_evidence (
  audit_bundle_id UUID NOT NULL REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  evidence_document_id UUID NOT NULL REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
  checksum_sha256 TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  evidence_type TEXT NOT NULL,
  reporting_period_start DATE,
  reporting_period_end DATE,
  PRIMARY KEY (audit_bundle_id, evidence_document_id)
);

CREATE OR REPLACE FUNCTION public.reject_completed_audit_bundle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed audit bundles are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed audit bundles are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_bundles_immutable ON public.audit_bundles;
CREATE TRIGGER trg_audit_bundles_immutable
BEFORE UPDATE OR DELETE ON public.audit_bundles
FOR EACH ROW EXECUTE FUNCTION public.reject_completed_audit_bundle_mutation();

CREATE OR REPLACE FUNCTION public.reject_audit_bundle_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE bundle_status TEXT;
DECLARE target_bundle_id UUID;
BEGIN
  target_bundle_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.audit_bundle_id
    ELSE NEW.audit_bundle_id
  END;
  SELECT status INTO bundle_status
  FROM public.audit_bundles
  WHERE id = target_bundle_id;
  IF bundle_status = 'completed' THEN
    RAISE EXCEPTION 'Evidence in a completed audit bundle is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_bundle_evidence_immutable ON public.audit_bundle_evidence;
CREATE TRIGGER trg_audit_bundle_evidence_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.audit_bundle_evidence
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_bundle_evidence_mutation();
