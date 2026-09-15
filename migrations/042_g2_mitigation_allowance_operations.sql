-- G2-04 mitigation planning and allowance/quota operations.
-- All records are internal, tenant-bound and append-only. They do not establish
-- legal title, registry ownership, surrender, transfer or regulatory compliance.

CREATE TABLE IF NOT EXISTS public.mitigation_initiative_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  initiative_reference TEXT NOT NULL CHECK (length(trim(initiative_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('proposed', 'approved_internal', 'in_progress', 'completed', 'cancelled')),
  owner_name TEXT NOT NULL CHECK (length(trim(owner_name)) BETWEEN 1 AND 240),
  baseline_year INTEGER NOT NULL CHECK (baseline_year BETWEEN 2020 AND 2200),
  baseline_inventory_id UUID,
  target_reduction_tco2e NUMERIC NOT NULL CHECK (target_reduction_tco2e > 0),
  planned_start DATE NOT NULL,
  planned_end DATE NOT NULL,
  methodology JSONB NOT NULL CHECK (jsonb_typeof(methodology) = 'object'),
  assumptions JSONB NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  initiative_sha256 TEXT NOT NULL CHECK (initiative_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, initiative_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (baseline_inventory_id, company_id) REFERENCES public.corporate_ghg_inventory_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (planned_end >= planned_start)
);

CREATE TABLE IF NOT EXISTS public.mitigation_initiative_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL,
  evidence_document_id UUID NOT NULL,
  evidence_role TEXT NOT NULL CHECK (evidence_role IN ('baseline', 'methodology', 'approval', 'implementation', 'monitoring', 'verification')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(initiative_id, evidence_document_id, evidence_role),
  FOREIGN KEY (initiative_id, company_id) REFERENCES public.mitigation_initiative_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.mitigation_scenario_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL,
  scenario_reference TEXT NOT NULL CHECK (length(trim(scenario_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  scenario_type TEXT NOT NULL CHECK (scenario_type IN ('baseline', 'planned', 'conservative', 'stress')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  baseline_emissions_tco2e NUMERIC NOT NULL CHECK (baseline_emissions_tco2e >= 0),
  projected_emissions_tco2e NUMERIC NOT NULL CHECK (projected_emissions_tco2e >= 0),
  expected_reduction_tco2e NUMERIC NOT NULL CHECK (expected_reduction_tco2e >= 0),
  annual_projection JSONB NOT NULL CHECK (jsonb_typeof(annual_projection) = 'array'),
  assumptions JSONB NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  sensitivity JSONB NOT NULL CHECK (jsonb_typeof(sensitivity) = 'object'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  scenario_sha256 TEXT NOT NULL CHECK (scenario_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, scenario_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (initiative_id, company_id) REFERENCES public.mitigation_initiative_revisions(id, company_id) ON DELETE RESTRICT,
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.mitigation_scenario_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL,
  evidence_document_id UUID NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scenario_id, evidence_document_id),
  FOREIGN KEY (scenario_id, company_id) REFERENCES public.mitigation_scenario_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.allowance_allocation_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  allocation_reference TEXT NOT NULL CHECK (length(trim(allocation_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 2020 AND 2200),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('authority_quota', 'internal_budget', 'transfer_reference', 'credit_reference')),
  record_status TEXT NOT NULL CHECK (record_status IN ('draft_reference', 'evidence_confirmed')),
  quantity_tco2e NUMERIC NOT NULL CHECK (quantity_tco2e > 0),
  vintage_year INTEGER CHECK (vintage_year IS NULL OR vintage_year BETWEEN 2020 AND 2200),
  external_reference TEXT,
  evidence_document_id UUID,
  legal_basis_snapshot JSONB NOT NULL CHECK (jsonb_typeof(legal_basis_snapshot) = 'object'),
  notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 5000),
  allocation_sha256 TEXT NOT NULL CHECK (allocation_sha256 ~* '^[a-f0-9]{64}$'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, allocation_reference, revision),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_document_id, company_id) REFERENCES public.evidence_documents(id, company_id) ON DELETE RESTRICT,
  CHECK (record_status <> 'evidence_confirmed' OR (external_reference IS NOT NULL AND evidence_document_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.allowance_position_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_revision_id UUID NOT NULL,
  corporate_inventory_id UUID NOT NULL,
  reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 2020 AND 2200),
  allocation_ids JSONB NOT NULL CHECK (jsonb_typeof(allocation_ids) = 'array'),
  scenario_ids JSONB NOT NULL CHECK (jsonb_typeof(scenario_ids) = 'array'),
  gross_emissions_tco2e NUMERIC NOT NULL CHECK (gross_emissions_tco2e >= 0),
  authority_quota_tco2e NUMERIC NOT NULL CHECK (authority_quota_tco2e >= 0),
  internal_budget_tco2e NUMERIC NOT NULL CHECK (internal_budget_tco2e >= 0),
  credit_reference_tco2e NUMERIC NOT NULL CHECK (credit_reference_tco2e >= 0),
  planned_reduction_tco2e NUMERIC NOT NULL CHECK (planned_reduction_tco2e >= 0),
  projected_position_tco2e NUMERIC NOT NULL,
  readiness_status TEXT NOT NULL CHECK (readiness_status IN ('needs_information', 'ready_for_internal_review')),
  blockers JSONB NOT NULL CHECK (jsonb_typeof(blockers) = 'array'),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  disclaimer TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, facility_revision_id, corporate_inventory_id, payload_sha256),
  UNIQUE(id, company_id),
  FOREIGN KEY (facility_revision_id, company_id) REFERENCES public.industrial_facility_revisions(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (corporate_inventory_id, company_id) REFERENCES public.corporate_ghg_inventory_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mitigation_initiative_tenant ON public.mitigation_initiative_revisions(company_id, initiative_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_mitigation_evidence_tenant ON public.mitigation_initiative_evidence(company_id, initiative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mitigation_scenario_tenant ON public.mitigation_scenario_revisions(company_id, initiative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mitigation_scenario_evidence_tenant ON public.mitigation_scenario_evidence(company_id, scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_allowance_allocation_tenant ON public.allowance_allocation_revisions(company_id, facility_revision_id, reporting_year, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_allowance_position_tenant ON public.allowance_position_snapshots(company_id, facility_revision_id, reporting_year, created_at DESC);

DROP TRIGGER IF EXISTS trg_mitigation_initiative_immutable ON public.mitigation_initiative_revisions;
CREATE TRIGGER trg_mitigation_initiative_immutable BEFORE UPDATE OR DELETE ON public.mitigation_initiative_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_mitigation_evidence_immutable ON public.mitigation_initiative_evidence;
CREATE TRIGGER trg_mitigation_evidence_immutable BEFORE UPDATE OR DELETE ON public.mitigation_initiative_evidence FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_mitigation_scenario_immutable ON public.mitigation_scenario_revisions;
CREATE TRIGGER trg_mitigation_scenario_immutable BEFORE UPDATE OR DELETE ON public.mitigation_scenario_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_mitigation_scenario_evidence_immutable ON public.mitigation_scenario_evidence;
CREATE TRIGGER trg_mitigation_scenario_evidence_immutable BEFORE UPDATE OR DELETE ON public.mitigation_scenario_evidence FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_allowance_allocation_immutable ON public.allowance_allocation_revisions;
CREATE TRIGGER trg_allowance_allocation_immutable BEFORE UPDATE OR DELETE ON public.allowance_allocation_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
DROP TRIGGER IF EXISTS trg_allowance_position_immutable ON public.allowance_position_snapshots;
CREATE TRIGGER trg_allowance_position_immutable BEFORE UPDATE OR DELETE ON public.allowance_position_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_industrial_core_mutation();
