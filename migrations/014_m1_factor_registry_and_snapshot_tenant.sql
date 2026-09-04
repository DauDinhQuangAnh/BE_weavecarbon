-- M1 / WP-CARB6 + WP-SEC1
-- Adds a durable, immutable factor provenance catalog and makes finalized
-- product snapshots explicitly tenant-owned. Existing calculation rows are
-- preserved; the migration aborts if a snapshot cannot be backfilled safely.

CREATE TABLE IF NOT EXISTS public.emission_factor_registries (
  registry_version TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL,
  release TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  factor_count INTEGER NOT NULL CHECK (factor_count >= 0),
  gwp_bases JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.emission_factors (
  factor_version_id TEXT PRIMARY KEY,
  registry_version TEXT NOT NULL
    REFERENCES public.emission_factor_registries(registry_version) ON DELETE RESTRICT,
  factor_id TEXT NOT NULL,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL CHECK (value >= 0),
  unit TEXT NOT NULL CHECK (unit IN (
    'kgCO2e/kg', 'kgCO2e/kWh', 'kWh/kg', 'kgCO2e/tonne.km'
  )),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_year INTEGER,
  geography TEXT NOT NULL,
  boundary TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  quality TEXT NOT NULL,
  factor_class TEXT NOT NULL,
  uncertainty_cv NUMERIC NOT NULL CHECK (uncertainty_cv >= 0),
  is_proxy BOOLEAN NOT NULL DEFAULT false,
  gwp_basis TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (registry_version, factor_id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE OR REPLACE FUNCTION public.reject_factor_catalog_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Published emission factor history is immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_emission_factor_registry_immutable
  ON public.emission_factor_registries;
CREATE TRIGGER trg_emission_factor_registry_immutable
BEFORE UPDATE OR DELETE ON public.emission_factor_registries
FOR EACH ROW EXECUTE FUNCTION public.reject_factor_catalog_mutation();

DROP TRIGGER IF EXISTS trg_emission_factor_immutable
  ON public.emission_factors;
CREATE TRIGGER trg_emission_factor_immutable
BEFORE UPDATE OR DELETE ON public.emission_factors
FOR EACH ROW EXECUTE FUNCTION public.reject_factor_catalog_mutation();

ALTER TABLE public.product_assessment_snapshots
  ADD COLUMN IF NOT EXISTS company_id UUID;

-- Migration 013 protects finalized rows from application updates. Temporarily
-- remove that trigger inside this migration transaction so the ownership-only
-- backfill can run; restore it before commit.
DROP TRIGGER IF EXISTS trg_product_snapshot_immutable
  ON public.product_assessment_snapshots;

UPDATE public.product_assessment_snapshots snapshots
SET company_id = products.company_id
FROM public.products products
WHERE snapshots.product_id = products.id
  AND snapshots.company_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.product_assessment_snapshots snapshots
    LEFT JOIN public.products products ON products.id = snapshots.product_id
    WHERE snapshots.company_id IS NULL
       OR products.id IS NULL
       OR snapshots.company_id <> products.company_id
  ) THEN
    RAISE EXCEPTION 'Snapshot tenant backfill failed: orphaned or cross-tenant rows exist';
  END IF;
END;
$$;

ALTER TABLE public.product_assessment_snapshots
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_id_company_id_key;
ALTER TABLE public.products
  ADD CONSTRAINT products_id_company_id_key UNIQUE (id, company_id);

ALTER TABLE public.product_assessment_snapshots
  DROP CONSTRAINT IF EXISTS product_snapshots_product_company_fk;
ALTER TABLE public.product_assessment_snapshots
  ADD CONSTRAINT product_snapshots_product_company_fk
  FOREIGN KEY (product_id, company_id)
  REFERENCES public.products(id, company_id)
  ON DELETE CASCADE;

CREATE TRIGGER trg_product_snapshot_immutable
BEFORE UPDATE ON public.product_assessment_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.reject_finalized_calculation_snapshot_update();

CREATE OR REPLACE VIEW public.latest_product_assessment_snapshots AS
SELECT DISTINCT ON (company_id, product_id) *
FROM public.product_assessment_snapshots
ORDER BY company_id, product_id, version DESC, calculated_at DESC, created_at DESC;
