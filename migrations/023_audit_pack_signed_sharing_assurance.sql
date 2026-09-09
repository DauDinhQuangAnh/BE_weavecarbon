-- Signed internal assertions, expiring read-only shares and append-only external-assurance records.

ALTER TABLE public.audit_bundle_reviews
  ADD COLUMN IF NOT EXISTS reviewer_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_email_snapshot TEXT;

ALTER TABLE public.audit_bundle_issuances
  ADD COLUMN IF NOT EXISTS signer_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS signer_email_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS signature_payload JSONB,
  ADD COLUMN IF NOT EXISTS signature_payload_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS signature_public_key TEXT,
  ADD COLUMN IF NOT EXISTS signature_value TEXT,
  ADD COLUMN IF NOT EXISTS signature_acknowledged_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_issuance_signature_complete'
  ) THEN
    ALTER TABLE public.audit_bundle_issuances
      ADD CONSTRAINT chk_audit_issuance_signature_complete CHECK (
        (signature_algorithm IS NULL AND signature_payload IS NULL AND signature_payload_sha256 IS NULL
          AND signature_public_key IS NULL AND signature_value IS NULL AND signature_acknowledged_at IS NULL)
        OR
        (signature_algorithm IS NOT NULL
          AND signature_payload IS NOT NULL
          AND signature_payload_sha256 IS NOT NULL
          AND signature_public_key IS NOT NULL
          AND signature_value IS NOT NULL
          AND signature_acknowledged_at IS NOT NULL
          AND signature_algorithm = 'ed25519-weavecarbon-attestation-v1'
          AND jsonb_typeof(signature_payload) = 'object'
          AND signature_payload_sha256 ~* '^[a-f0-9]{64}$'
          AND length(signature_public_key) > 0
          AND length(signature_value) > 0)
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_bundle_issuances_company_id_id
  ON public.audit_bundle_issuances(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_documents_company_id_id
  ON public.evidence_documents(company_id, id);

CREATE TABLE IF NOT EXISTS public.audit_bundle_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audit_bundle_id UUID NOT NULL REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  issuance_id UUID NOT NULL REFERENCES public.audit_bundle_issuances(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE CHECK (token_sha256 ~* '^[a-f0-9]{64}$'),
  label TEXT,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~* '^[a-f0-9]{64}$'),
  bundle_sha256 TEXT NOT NULL CHECK (bundle_sha256 ~* '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  max_downloads INTEGER CHECK (max_downloads BETWEEN 1 AND 100),
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_accessed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  revocation_reason TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, audit_bundle_id)
    REFERENCES public.audit_bundles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, issuance_id)
    REFERENCES public.audit_bundle_issuances(company_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (max_downloads IS NULL OR download_count <= max_downloads),
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_audit_bundle_share_links_bundle
  ON public.audit_bundle_share_links(company_id, audit_bundle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_bundle_share_links_active
  ON public.audit_bundle_share_links(token_sha256, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_bundle_assurance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  audit_bundle_id UUID NOT NULL REFERENCES public.audit_bundles(id) ON DELETE RESTRICT,
  issuance_id UUID NOT NULL REFERENCES public.audit_bundle_issuances(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'requested', 'evidence_received', 'limited_assurance', 'reasonable_assurance',
    'qualified', 'adverse', 'withdrawn'
  )),
  provider_name TEXT NOT NULL CHECK (length(trim(provider_name)) > 0),
  practitioner_name TEXT,
  standard TEXT,
  scope TEXT NOT NULL CHECK (length(trim(scope)) > 0),
  statement_date DATE,
  valid_to DATE,
  evidence_document_id UUID REFERENCES public.evidence_documents(id) ON DELETE RESTRICT,
  evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~* '^[a-f0-9]{64}$'),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~* '^[a-f0-9]{64}$'),
  bundle_sha256 TEXT NOT NULL CHECK (bundle_sha256 ~* '^[a-f0-9]{64}$'),
  notes TEXT,
  supersedes_id UUID REFERENCES public.audit_bundle_assurance_records(id) ON DELETE RESTRICT,
  recorded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, audit_bundle_id)
    REFERENCES public.audit_bundles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, issuance_id)
    REFERENCES public.audit_bundle_issuances(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, evidence_document_id)
    REFERENCES public.evidence_documents(company_id, id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR statement_date IS NULL OR valid_to >= statement_date),
  CHECK (
    outcome IN ('requested', 'withdrawn')
    OR (statement_date IS NOT NULL AND evidence_document_id IS NOT NULL AND evidence_sha256 IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_audit_bundle_assurance_latest
  ON public.audit_bundle_assurance_records(company_id, audit_bundle_id, recorded_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_audit_share_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit share records cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.audit_bundle_id IS DISTINCT FROM OLD.audit_bundle_id
     OR NEW.issuance_id IS DISTINCT FROM OLD.issuance_id
     OR NEW.token_sha256 IS DISTINCT FROM OLD.token_sha256
     OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
     OR NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.max_downloads IS DISTINCT FROM OLD.max_downloads
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.download_count < OLD.download_count
     OR NEW.download_count > OLD.download_count + 1
     OR ((NEW.download_count IS DISTINCT FROM OLD.download_count)
          <> (NEW.last_accessed_at IS DISTINCT FROM OLD.last_accessed_at))
     OR (OLD.revoked_at IS NOT NULL AND (
          NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
          OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
          OR NEW.download_count IS DISTINCT FROM OLD.download_count
          OR NEW.last_accessed_at IS DISTINCT FROM OLD.last_accessed_at
        ))
  THEN
    RAISE EXCEPTION 'Audit share identity and content binding are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_bundle_share_links_guard ON public.audit_bundle_share_links;
CREATE TRIGGER trg_audit_bundle_share_links_guard
BEFORE UPDATE OR DELETE ON public.audit_bundle_share_links
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_share_immutable_fields();

DROP TRIGGER IF EXISTS trg_audit_bundle_assurance_append_only ON public.audit_bundle_assurance_records;
CREATE TRIGGER trg_audit_bundle_assurance_append_only
BEFORE UPDATE OR DELETE ON public.audit_bundle_assurance_records
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_lifecycle_mutation();
