-- G2-13 enterprise security governance and production-acceptance evidence.
-- Secrets remain outside the database except AES-GCM encrypted per-user TOTP seeds.

CREATE TABLE IF NOT EXISTS public.user_mfa_factor_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','enabled','disabled')),
  secret_ciphertext TEXT,
  secret_iv TEXT,
  secret_auth_tag TEXT,
  recovery_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recovery_code_hashes) = 'array'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, revision),
  UNIQUE(id, user_id),
  CHECK ((status = 'disabled' AND secret_ciphertext IS NULL AND secret_iv IS NULL AND secret_auth_tag IS NULL) OR
         (status IN ('pending','enabled') AND secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL AND secret_auth_tag IS NOT NULL)),
  CHECK (status <> 'enabled' OR jsonb_array_length(recovery_code_hashes) >= 8)
);

CREATE TABLE IF NOT EXISTS public.user_mfa_recovery_code_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  factor_revision_id UUID NOT NULL,
  recovery_hash TEXT NOT NULL CHECK (length(recovery_hash) BETWEEN 64 AND 300),
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factor_revision_id, recovery_hash),
  FOREIGN KEY (factor_revision_id, user_id) REFERENCES public.user_mfa_factor_revisions(id, user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.enterprise_security_policy_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  policy_reference TEXT NOT NULL DEFAULT 'default' CHECK (length(trim(policy_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  require_mfa_for_admins BOOLEAN NOT NULL DEFAULT false,
  sso_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (sso_mode IN ('disabled','optional','required')),
  session_idle_minutes INTEGER NOT NULL DEFAULT 30 CHECK (session_idle_minutes BETWEEN 5 AND 1440),
  data_retention_days INTEGER NOT NULL DEFAULT 2555 CHECK (data_retention_days BETWEEN 30 AND 36500),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('draft','approved')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, policy_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.enterprise_sso_connection_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_reference TEXT NOT NULL CHECK (length(trim(connection_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  protocol TEXT NOT NULL CHECK (protocol = 'oidc'),
  issuer_url TEXT NOT NULL CHECK (issuer_url ~* '^https://'),
  authorization_endpoint TEXT NOT NULL CHECK (authorization_endpoint ~* '^https://'),
  token_endpoint TEXT NOT NULL CHECK (token_endpoint ~* '^https://'),
  jwks_uri TEXT NOT NULL CHECK (jwks_uri ~* '^https://'),
  client_id TEXT NOT NULL CHECK (length(trim(client_id)) BETWEEN 1 AND 500),
  client_secret_reference TEXT NOT NULL CHECK (length(trim(client_secret_reference)) BETWEEN 1 AND 500),
  allowed_email_domains TEXT[] NOT NULL CHECK (cardinality(allowed_email_domains) BETWEEN 1 AND 50),
  scopes TEXT[] NOT NULL DEFAULT ARRAY['openid','email','profile']::text[],
  required_acr TEXT,
  validation_checks JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_checks) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('draft','active','disabled')),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, connection_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.enterprise_key_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key_reference TEXT NOT NULL CHECK (length(trim(key_reference)) BETWEEN 1 AND 160),
  revision INTEGER NOT NULL CHECK (revision > 0),
  purpose TEXT NOT NULL CHECK (purpose IN ('jwt_signing','mfa_encryption','database_encryption','object_storage_encryption','weavenode_transport','deployment','integration')),
  provider TEXT NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 160),
  external_secret_reference TEXT NOT NULL CHECK (length(trim(external_secret_reference)) BETWEEN 1 AND 500),
  key_version TEXT NOT NULL CHECK (length(trim(key_version)) BETWEEN 1 AND 120),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('active','rotated','revoked')),
  effective_at TIMESTAMPTZ NOT NULL,
  rotation_due_at TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, key_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (rotation_due_at IS NULL OR rotation_due_at > effective_at)
);

CREATE TABLE IF NOT EXISTS public.enterprise_security_incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  incident_reference TEXT NOT NULL CHECK (length(trim(incident_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('detected','triaged','contained','eradicated','recovered','closed','reopened')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  occurred_at TIMESTAMPTZ NOT NULL,
  owner TEXT NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 240),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 5000),
  personal_data_involved BOOLEAN NOT NULL,
  regulatory_notification_required BOOLEAN NOT NULL,
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, incident_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.production_acceptance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  release_reference TEXT NOT NULL CHECK (length(trim(release_reference)) BETWEEN 1 AND 160),
  backend_commit_sha TEXT NOT NULL CHECK (backend_commit_sha ~* '^[a-f0-9]{40}$'),
  frontend_commit_sha TEXT NOT NULL CHECK (frontend_commit_sha ~* '^[a-f0-9]{40}$'),
  backend_image_digest TEXT NOT NULL CHECK (backend_image_digest ~* '^sha256:[a-f0-9]{64}$'),
  frontend_image_digest TEXT NOT NULL CHECK (frontend_image_digest ~* '^sha256:[a-f0-9]{64}$'),
  highest_migration TEXT NOT NULL CHECK (length(trim(highest_migration)) BETWEEN 1 AND 240),
  ci_run_url TEXT NOT NULL CHECK (ci_run_url ~* '^https://'),
  rollback_image_digest TEXT NOT NULL CHECK (rollback_image_digest ~* '^sha256:[a-f0-9]{64}$'),
  backup_restore_report_sha256 TEXT NOT NULL CHECK (backup_restore_report_sha256 ~* '^[a-f0-9]{64}$'),
  smoke_results JSONB NOT NULL CHECK (jsonb_typeof(smoke_results) = 'object'),
  security_scan_summary JSONB NOT NULL CHECK (jsonb_typeof(security_scan_summary) = 'object'),
  decision TEXT NOT NULL CHECK (decision IN ('blocked','accepted')),
  decision_rationale TEXT NOT NULL CHECK (length(trim(decision_rationale)) BETWEEN 1 AND 5000),
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, release_reference),
  UNIQUE(id, company_id),
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mfa_factor_latest ON public.user_mfa_factor_revisions(user_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_security_policy_latest ON public.enterprise_security_policy_revisions(company_id, policy_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_sso_connection_latest ON public.enterprise_sso_connection_revisions(company_id, connection_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_key_lifecycle_latest ON public.enterprise_key_lifecycle_events(company_id, key_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_security_incident_latest ON public.enterprise_security_incident_events(company_id, incident_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_production_acceptance_created ON public.production_acceptance_runs(company_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_mfa_factor_immutable ON public.user_mfa_factor_revisions;
CREATE TRIGGER trg_mfa_factor_immutable BEFORE UPDATE OR DELETE ON public.user_mfa_factor_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_mfa_recovery_consumption_immutable ON public.user_mfa_recovery_code_consumptions;
CREATE TRIGGER trg_mfa_recovery_consumption_immutable BEFORE UPDATE OR DELETE ON public.user_mfa_recovery_code_consumptions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_security_policy_immutable ON public.enterprise_security_policy_revisions;
CREATE TRIGGER trg_security_policy_immutable BEFORE UPDATE OR DELETE ON public.enterprise_security_policy_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_sso_connection_immutable ON public.enterprise_sso_connection_revisions;
CREATE TRIGGER trg_sso_connection_immutable BEFORE UPDATE OR DELETE ON public.enterprise_sso_connection_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_key_lifecycle_immutable ON public.enterprise_key_lifecycle_events;
CREATE TRIGGER trg_key_lifecycle_immutable BEFORE UPDATE OR DELETE ON public.enterprise_key_lifecycle_events FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_security_incident_immutable ON public.enterprise_security_incident_events;
CREATE TRIGGER trg_security_incident_immutable BEFORE UPDATE OR DELETE ON public.enterprise_security_incident_events FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_production_acceptance_immutable ON public.production_acceptance_runs;
CREATE TRIGGER trg_production_acceptance_immutable BEFORE UPDATE OR DELETE ON public.production_acceptance_runs FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
