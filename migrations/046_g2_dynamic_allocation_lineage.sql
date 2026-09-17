-- G2-08 deterministic, multi-level industrial allocation lineage.
-- Rules, runs and lines are tenant-bound, append-only and versioned.

CREATE TABLE IF NOT EXISTS public.industrial_allocation_rule_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  allocation_reference TEXT NOT NULL CHECK (length(trim(allocation_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_level TEXT NOT NULL CHECK (source_level IN ('facility', 'process', 'batch')),
  target_level TEXT NOT NULL CHECK (target_level IN ('process', 'batch', 'product')),
  allocation_method TEXT NOT NULL CHECK (allocation_method IN ('mass', 'energy', 'output', 'machine_hour', 'economic', 'custom_driver')),
  driver_unit TEXT NOT NULL CHECK (length(trim(driver_unit)) BETWEEN 1 AND 100),
  methodology_reference TEXT NOT NULL CHECK (length(trim(methodology_reference)) BETWEEN 1 AND 500),
  methodology_version TEXT NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 120),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('draft', 'approved')),
  evidence_document_id UUID,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'object'),
  rule_sha256 TEXT NOT NULL CHECK (rule_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, allocation_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id)
    REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id)
    REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (
    (source_level = 'facility' AND target_level IN ('process', 'batch', 'product')) OR
    (source_level = 'process' AND target_level IN ('batch', 'product')) OR
    (source_level = 'batch' AND target_level = 'product')
  ),
  CHECK (
    (approval_status = 'draft') OR
    (approval_status = 'approved' AND evidence_document_id IS NOT NULL AND evidence_snapshot <> '{}'::jsonb)
  )
);

CREATE INDEX IF NOT EXISTS idx_industrial_allocation_rules_tenant
  ON public.industrial_allocation_rule_revisions(company_id, allocation_reference, revision DESC);

CREATE TABLE IF NOT EXISTS public.industrial_allocation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  rule_revision_id UUID NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('activity', 'allocation_line')),
  source_activity_id UUID,
  source_allocation_line_id UUID,
  source_quantity NUMERIC(24,8) NOT NULL CHECK (source_quantity >= 0),
  source_unit TEXT NOT NULL CHECK (length(trim(source_unit)) BETWEEN 1 AND 100),
  driver_total NUMERIC(24,8) NOT NULL CHECK (driver_total > 0),
  allocated_quantity NUMERIC(24,8) NOT NULL CHECK (allocated_quantity >= 0),
  reconciliation_difference NUMERIC(24,8) NOT NULL,
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status = 'reconciled'),
  source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  rule_snapshot JSONB NOT NULL CHECK (jsonb_typeof(rule_snapshot) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, payload_sha256),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id)
    REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (rule_revision_id, company_id)
    REFERENCES public.industrial_allocation_rule_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_activity_id, company_id)
    REFERENCES public.industrial_activity_records(id, company_id) ON DELETE RESTRICT,
  CHECK (
    (source_kind = 'activity' AND source_activity_id IS NOT NULL AND source_allocation_line_id IS NULL) OR
    (source_kind = 'allocation_line' AND source_activity_id IS NULL AND source_allocation_line_id IS NOT NULL)
  ),
  CHECK (abs(reconciliation_difference) <= 0.00000001)
);

CREATE INDEX IF NOT EXISTS idx_industrial_allocation_runs_tenant
  ON public.industrial_allocation_runs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.industrial_allocation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  target_level TEXT NOT NULL CHECK (target_level IN ('process', 'batch', 'product')),
  target_entity_id UUID NOT NULL,
  target_reference TEXT NOT NULL CHECK (length(trim(target_reference)) BETWEEN 1 AND 240),
  driver_value NUMERIC(24,8) NOT NULL CHECK (driver_value > 0),
  driver_unit TEXT NOT NULL CHECK (length(trim(driver_unit)) BETWEEN 1 AND 100),
  allocation_share NUMERIC(18,12) NOT NULL CHECK (allocation_share > 0 AND allocation_share <= 1),
  allocated_quantity NUMERIC(24,8) NOT NULL CHECK (allocated_quantity >= 0),
  canonical_unit TEXT NOT NULL CHECK (length(trim(canonical_unit)) BETWEEN 1 AND 100),
  line_sha256 TEXT NOT NULL CHECK (line_sha256 ~* '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, run_id, line_number),
  UNIQUE(id, company_id),
  FOREIGN KEY (run_id, company_id)
    REFERENCES public.industrial_allocation_runs(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_industrial_allocation_lines_target
  ON public.industrial_allocation_lines(company_id, target_level, target_entity_id, created_at DESC);

ALTER TABLE public.industrial_allocation_runs
  DROP CONSTRAINT IF EXISTS fk_industrial_allocation_source_line;
ALTER TABLE public.industrial_allocation_runs
  ADD CONSTRAINT fk_industrial_allocation_source_line
  FOREIGN KEY (source_allocation_line_id, company_id)
  REFERENCES public.industrial_allocation_lines(id, company_id) ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS trg_industrial_allocation_rule_immutable ON public.industrial_allocation_rule_revisions;
CREATE TRIGGER trg_industrial_allocation_rule_immutable BEFORE UPDATE OR DELETE ON public.industrial_allocation_rule_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_allocation_run_immutable ON public.industrial_allocation_runs;
CREATE TRIGGER trg_industrial_allocation_run_immutable BEFORE UPDATE OR DELETE ON public.industrial_allocation_runs
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_industrial_allocation_line_immutable ON public.industrial_allocation_lines;
CREATE TRIGGER trg_industrial_allocation_line_immutable BEFORE UPDATE OR DELETE ON public.industrial_allocation_lines
  FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
