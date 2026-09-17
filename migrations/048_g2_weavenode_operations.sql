-- G2-10 WeaveNode operational management baseline.
-- Adds dual-time provenance, signed health/update ledgers and meter hierarchy reconciliation.

ALTER TABLE public.weavenode_packets
  ADD COLUMN IF NOT EXISTS source_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gateway_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_gateway_drift_seconds NUMERIC(18,3);

CREATE TABLE IF NOT EXISTS public.industrial_meter_hierarchy_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  hierarchy_reference TEXT NOT NULL CHECK (length(trim(hierarchy_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  parent_measurement_point_revision_id UUID NOT NULL,
  child_measurement_point_revision_id UUID NOT NULL,
  relation_kind TEXT NOT NULL CHECK (relation_kind IN ('sub_meter', 'line_meter', 'machine_meter')),
  tolerance_percent NUMERIC(8,4) NOT NULL CHECK (tolerance_percent >= 0 AND tolerance_percent <= 100),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  hierarchy_sha256 TEXT NOT NULL CHECK (hierarchy_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, hierarchy_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_measurement_point_revision_id, company_id) REFERENCES public.industrial_measurement_point_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (child_measurement_point_revision_id, company_id) REFERENCES public.industrial_measurement_point_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (parent_measurement_point_revision_id <> child_measurement_point_revision_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS public.industrial_meter_reconciliation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  parent_measurement_point_revision_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  canonical_unit TEXT NOT NULL,
  parent_quantity NUMERIC(24,8) NOT NULL CHECK (parent_quantity >= 0),
  child_quantity NUMERIC(24,8) NOT NULL CHECK (child_quantity >= 0),
  difference_quantity NUMERIC(24,8) NOT NULL,
  difference_percent NUMERIC(18,8),
  tolerance_percent NUMERIC(8,4) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reconciled', 'outside_tolerance', 'missing_data')),
  hierarchy_snapshot JSONB NOT NULL CHECK (jsonb_typeof(hierarchy_snapshot) = 'array'),
  activity_snapshot JSONB NOT NULL CHECK (jsonb_typeof(activity_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, payload_sha256),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_measurement_point_revision_id, company_id) REFERENCES public.industrial_measurement_point_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS public.weavenode_health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL CHECK (sequence_number BETWEEN 1 AND 9007199254740991),
  source_recorded_at TIMESTAMPTZ NOT NULL,
  gateway_received_at TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_drift_seconds NUMERIC(18,3) NOT NULL,
  firmware_version TEXT NOT NULL CHECK (length(trim(firmware_version)) BETWEEN 1 AND 120),
  config_version TEXT NOT NULL CHECK (length(trim(config_version)) BETWEEN 1 AND 120),
  buffer_depth INTEGER NOT NULL CHECK (buffer_depth >= 0),
  storage_free_bytes BIGINT NOT NULL CHECK (storage_free_bytes >= 0),
  sensor_status TEXT NOT NULL CHECK (sensor_status IN ('ok', 'warning', 'fault')),
  fault_codes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fault_codes) = 'array'),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  signature_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, sequence_number),
  UNIQUE(id, company_id),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT,
  CHECK (gateway_received_at >= source_recorded_at)
);

CREATE TABLE IF NOT EXISTS public.weavenode_release_signing_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key_reference TEXT NOT NULL CHECK (length(trim(key_reference)) BETWEEN 1 AND 120),
  public_key_pem TEXT NOT NULL,
  public_key_sha256 TEXT NOT NULL CHECK (public_key_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, key_reference),
  UNIQUE(company_id, public_key_sha256),
  UNIQUE(id, company_id)
);

CREATE TABLE IF NOT EXISTS public.weavenode_release_key_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  signing_key_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'revoked'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, signing_key_id, event_type),
  FOREIGN KEY (signing_key_id, company_id) REFERENCES public.weavenode_release_signing_keys(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.weavenode_update_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  update_reference TEXT NOT NULL CHECK (length(trim(update_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  update_kind TEXT NOT NULL CHECK (update_kind IN ('firmware', 'configuration')),
  target_version TEXT NOT NULL CHECK (length(trim(target_version)) BETWEEN 1 AND 120),
  rollout_stage TEXT NOT NULL CHECK (rollout_stage IN ('staged', 'canary', 'production', 'rollback')),
  artifact_sha256 TEXT NOT NULL CHECK (artifact_sha256 ~* '^[a-f0-9]{64}$'),
  signing_key_id UUID NOT NULL,
  manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~* '^[a-f0-9]{64}$'),
  signature_base64 TEXT NOT NULL,
  rollback_of_update_id UUID,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, device_id, update_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (signing_key_id, company_id) REFERENCES public.weavenode_release_signing_keys(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (rollback_of_update_id, company_id) REFERENCES public.weavenode_update_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK ((rollout_stage = 'rollback' AND rollback_of_update_id IS NOT NULL) OR (rollout_stage <> 'rollback' AND rollback_of_update_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_meter_hierarchy_parent ON public.industrial_meter_hierarchy_revisions(company_id, parent_measurement_point_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meter_reconciliation_parent ON public.industrial_meter_reconciliation_snapshots(company_id, parent_measurement_point_revision_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_weavenode_health_device ON public.weavenode_health_reports(company_id, device_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_weavenode_update_device ON public.weavenode_update_revisions(company_id, device_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_meter_hierarchy_immutable ON public.industrial_meter_hierarchy_revisions;
CREATE TRIGGER trg_meter_hierarchy_immutable BEFORE UPDATE OR DELETE ON public.industrial_meter_hierarchy_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_meter_reconciliation_immutable ON public.industrial_meter_reconciliation_snapshots;
CREATE TRIGGER trg_meter_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.industrial_meter_reconciliation_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_health_immutable ON public.weavenode_health_reports;
CREATE TRIGGER trg_weavenode_health_immutable BEFORE UPDATE OR DELETE ON public.weavenode_health_reports FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_release_key_immutable ON public.weavenode_release_signing_keys;
CREATE TRIGGER trg_weavenode_release_key_immutable BEFORE UPDATE OR DELETE ON public.weavenode_release_signing_keys FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_release_key_event_immutable ON public.weavenode_release_key_events;
CREATE TRIGGER trg_weavenode_release_key_event_immutable BEFORE UPDATE OR DELETE ON public.weavenode_release_key_events FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_update_immutable ON public.weavenode_update_revisions;
CREATE TRIGGER trg_weavenode_update_immutable BEFORE UPDATE OR DELETE ON public.weavenode_update_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
