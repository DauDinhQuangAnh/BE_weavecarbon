-- G2 Industrial Core baseline.
-- Additive, tenant-bound and append-only canonical records for domestic MRV work.

CREATE TABLE IF NOT EXISTS public.industrial_facility_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_reference TEXT NOT NULL CHECK (length(trim(facility_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 240),
  country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('planned', 'active', 'inactive')),
  boundary_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, facility_reference, revision),
  UNIQUE(id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_industrial_facility_tenant
  ON public.industrial_facility_revisions(company_id, facility_reference, revision DESC);

CREATE TABLE IF NOT EXISTS public.industrial_process_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  process_reference TEXT NOT NULL CHECK (length(trim(process_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 240),
  process_type TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('planned', 'active', 'inactive')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, process_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id)
    REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_process_tenant
  ON public.industrial_process_revisions(company_id, facility_revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.industrial_measurement_point_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  process_revision_id UUID,
  measurement_point_reference TEXT NOT NULL CHECK (length(trim(measurement_point_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  measurement_type TEXT NOT NULL,
  canonical_unit TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('meter', 'plc', 'sensor', 'weavenode', 'manual', 'api')),
  device_identity TEXT,
  calibration_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (calibration_status IN ('unknown', 'current', 'expired', 'not_applicable')),
  calibration_due_on DATE,
  sampling_interval_seconds INTEGER CHECK (sampling_interval_seconds IS NULL OR sampling_interval_seconds > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, measurement_point_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id)
    REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (process_revision_id, company_id)
    REFERENCES public.industrial_process_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_measurement_point_tenant
  ON public.industrial_measurement_point_revisions(company_id, facility_revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.industrial_activity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  process_revision_id UUID,
  measurement_point_revision_id UUID,
  activity_reference TEXT NOT NULL CHECK (length(trim(activity_reference)) BETWEEN 1 AND 120),
  activity_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  quantity NUMERIC(24,8) NOT NULL CHECK (quantity >= 0),
  canonical_unit TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('invoice', 'meter', 'plc', 'sensor', 'supplier', 'manual', 'api')),
  data_quality_level TEXT NOT NULL CHECK (data_quality_level IN ('L1', 'L2', 'L3', 'L4', 'L5')),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload) = 'object'),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, activity_reference, source_sha256),
  UNIQUE(id, company_id),
  CHECK (period_end >= period_start),
  FOREIGN KEY (facility_revision_id, company_id)
    REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (process_revision_id, company_id)
    REFERENCES public.industrial_process_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (measurement_point_revision_id, company_id)
    REFERENCES public.industrial_measurement_point_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_activity_tenant_period
  ON public.industrial_activity_records(company_id, period_start DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_industrial_activity_facility
  ON public.industrial_activity_records(company_id, facility_revision_id, period_start DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_documents_id_company
  ON public.evidence_documents(id, company_id);

CREATE TABLE IF NOT EXISTS public.industrial_activity_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL,
  evidence_document_id UUID NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'supports_activity'
    CHECK (relationship IN ('supports_activity', 'source_document', 'calibration_record', 'review_record')),
  linked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, activity_id, evidence_document_id, relationship),
  FOREIGN KEY (activity_id, company_id)
    REFERENCES public.industrial_activity_records(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_activity_evidence_tenant
  ON public.industrial_activity_evidence(company_id, activity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_industrial_core_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Industrial core revisions and activity records are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_industrial_facility_immutable ON public.industrial_facility_revisions;
CREATE TRIGGER trg_industrial_facility_immutable BEFORE UPDATE OR DELETE ON public.industrial_facility_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_process_immutable ON public.industrial_process_revisions;
CREATE TRIGGER trg_industrial_process_immutable BEFORE UPDATE OR DELETE ON public.industrial_process_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_measurement_point_immutable ON public.industrial_measurement_point_revisions;
CREATE TRIGGER trg_industrial_measurement_point_immutable BEFORE UPDATE OR DELETE ON public.industrial_measurement_point_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_activity_immutable ON public.industrial_activity_records;
CREATE TRIGGER trg_industrial_activity_immutable BEFORE UPDATE OR DELETE ON public.industrial_activity_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_activity_evidence_immutable ON public.industrial_activity_evidence;
CREATE TRIGGER trg_industrial_activity_evidence_immutable BEFORE UPDATE OR DELETE ON public.industrial_activity_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
