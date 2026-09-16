-- G2-06 WeaveNode signed ingestion pilot. Append-only device, calibration,
-- packet and replay ledgers; no automatic GHG or verification claim.

CREATE TABLE IF NOT EXISTS public.weavenode_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  measurement_point_revision_id UUID NOT NULL,
  device_reference TEXT NOT NULL CHECK (length(trim(device_reference)) BETWEEN 1 AND 120),
  public_key_pem TEXT NOT NULL,
  public_key_sha256 TEXT NOT NULL CHECK (public_key_sha256 ~* '^[a-f0-9]{64}$'),
  protocol_version TEXT NOT NULL DEFAULT 'weavenode-ed25519-v1',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, device_reference), UNIQUE(company_id, public_key_sha256), UNIQUE(id, company_id),
  FOREIGN KEY (measurement_point_revision_id, company_id) REFERENCES public.industrial_measurement_point_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.weavenode_device_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'revoked'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, device_id, event_type),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.weavenode_calibration_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,
  evidence_document_id UUID NOT NULL,
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 2000),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, company_id), UNIQUE(device_id, id, company_id),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS public.weavenode_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL CHECK (sequence_number BETWEEN 1 AND 9007199254740991),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  signature_base64 TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, sequence_number), UNIQUE(id, company_id), UNIQUE(device_id, id, company_id, sequence_number),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.weavenode_packet_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  packet_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL,
  calibration_revision_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  processed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, sequence_number), UNIQUE(packet_id), UNIQUE(activity_id),
  FOREIGN KEY (device_id, company_id) REFERENCES public.weavenode_devices(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (device_id, packet_id, company_id, sequence_number) REFERENCES public.weavenode_packets(device_id, id, company_id, sequence_number) ON DELETE RESTRICT,
  FOREIGN KEY (device_id, calibration_revision_id, company_id) REFERENCES public.weavenode_calibration_revisions(device_id, id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (activity_id, company_id) REFERENCES public.industrial_activity_records(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_weavenode_devices_point ON public.weavenode_devices(company_id, measurement_point_revision_id);
CREATE INDEX IF NOT EXISTS idx_weavenode_events_device ON public.weavenode_device_events(company_id, device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weavenode_calibration_device ON public.weavenode_calibration_revisions(company_id, device_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_weavenode_calibration_evidence ON public.weavenode_calibration_revisions(company_id, evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_weavenode_packets_tenant_device ON public.weavenode_packets(company_id, device_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_weavenode_acceptances_tenant_device ON public.weavenode_packet_acceptances(company_id, device_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_weavenode_acceptances_calibration ON public.weavenode_packet_acceptances(company_id, calibration_revision_id);

DROP TRIGGER IF EXISTS trg_weavenode_devices_immutable ON public.weavenode_devices;
CREATE TRIGGER trg_weavenode_devices_immutable BEFORE UPDATE OR DELETE ON public.weavenode_devices FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_device_events_immutable ON public.weavenode_device_events;
CREATE TRIGGER trg_weavenode_device_events_immutable BEFORE UPDATE OR DELETE ON public.weavenode_device_events FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_calibration_immutable ON public.weavenode_calibration_revisions;
CREATE TRIGGER trg_weavenode_calibration_immutable BEFORE UPDATE OR DELETE ON public.weavenode_calibration_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_packets_immutable ON public.weavenode_packets;
CREATE TRIGGER trg_weavenode_packets_immutable BEFORE UPDATE OR DELETE ON public.weavenode_packets FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_weavenode_acceptances_immutable ON public.weavenode_packet_acceptances;
CREATE TRIGGER trg_weavenode_acceptances_immutable BEFORE UPDATE OR DELETE ON public.weavenode_packet_acceptances FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
