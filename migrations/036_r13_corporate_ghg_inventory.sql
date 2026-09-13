-- R13 immutable corporate/facility GHG inventory revisions and internal reviews.
-- Records remain limited internal inventories until authentic assurance is attached.

CREATE TABLE IF NOT EXISTS public.corporate_ghg_inventory_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_reference TEXT NOT NULL CHECK (length(trim(inventory_reference)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL CHECK (revision > 0),
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  ruleset_coverage TEXT NOT NULL CHECK (ruleset_coverage IN ('limited', 'complete')),
  source_manifest_sha256 TEXT NOT NULL CHECK (source_manifest_sha256 ~* '^[a-f0-9]{64}$'),
  inventory_date DATE NOT NULL,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  activity_snapshot JSONB NOT NULL CHECK (jsonb_typeof(activity_snapshot) = 'array'),
  activity_snapshot_sha256 TEXT NOT NULL CHECK (activity_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  automated_status TEXT NOT NULL CHECK (automated_status IN ('needs_information', 'inventory_review_required')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, inventory_reference, revision),
  UNIQUE(id, company_id),
  CHECK (reporting_period_end >= reporting_period_start)
);

CREATE INDEX IF NOT EXISTS idx_corporate_ghg_inventory_tenant
  ON public.corporate_ghg_inventory_revisions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corporate_ghg_inventory_reference
  ON public.corporate_ghg_inventory_revisions(company_id, inventory_reference, revision DESC);
CREATE INDEX IF NOT EXISTS idx_corporate_ghg_inventory_created_by
  ON public.corporate_ghg_inventory_revisions(created_by);

CREATE TABLE IF NOT EXISTS public.corporate_ghg_inventory_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name_snapshot TEXT NOT NULL CHECK (length(trim(reviewer_name_snapshot)) > 0),
  reviewer_email_snapshot TEXT,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role = 'corporate_ghg_inventory_reviewer'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_internal_report', 'needs_information', 'rejected')),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~* '^[a-f0-9]{64}$'),
  activity_snapshot_sha256 TEXT NOT NULL CHECK (activity_snapshot_sha256 ~* '^[a-f0-9]{64}$'),
  result_sha256 TEXT NOT NULL CHECK (result_sha256 ~* '^[a-f0-9]{64}$'),
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (inventory_id, company_id)
    REFERENCES public.corporate_ghg_inventory_revisions(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_corporate_ghg_inventory_reviews
  ON public.corporate_ghg_inventory_reviews(company_id, inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corporate_ghg_inventory_reviews_reviewer
  ON public.corporate_ghg_inventory_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION public.reject_corporate_ghg_inventory_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Corporate GHG inventory revisions and reviews are append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_corporate_ghg_inventory_immutable ON public.corporate_ghg_inventory_revisions;
CREATE TRIGGER trg_corporate_ghg_inventory_immutable BEFORE UPDATE OR DELETE ON public.corporate_ghg_inventory_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_corporate_ghg_inventory_mutation();
DROP TRIGGER IF EXISTS trg_corporate_ghg_inventory_reviews_immutable ON public.corporate_ghg_inventory_reviews;
CREATE TRIGGER trg_corporate_ghg_inventory_reviews_immutable BEFORE UPDATE OR DELETE ON public.corporate_ghg_inventory_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_corporate_ghg_inventory_mutation();
