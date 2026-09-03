-- WP-CARB5: immutable, reproducible calculation snapshots.

ALTER TABLE public.product_assessment_snapshots
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT,
  ADD COLUMN IF NOT EXISTS factor_registry_version TEXT,
  ADD COLUMN IF NOT EXISTS gwp_basis TEXT,
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canonical_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS factor_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

UPDATE public.product_assessment_snapshots
SET
  engine_version = COALESCE(
    NULLIF(payload #>> '{carbonResults,trace,ruleEngineVersion}', ''),
    'legacy-unversioned'
  ),
  methodology_version = COALESCE(
    NULLIF(payload #>> '{carbonResults,methodologyVersion}', ''),
    'legacy-unversioned'
  ),
  factor_registry_version = 'legacy-unversioned',
  gwp_basis = COALESCE(
    NULLIF(payload #>> '{carbonResults,methodology,gwpBasis}', ''),
    'legacy-unversioned'
  ),
  calculated_at = COALESCE(updated_at, created_at, now()),
  canonical_input_hash = 'legacy:' || id::text,
  factor_snapshot = CASE
    WHEN jsonb_typeof(payload #> '{carbonResults,factorSourceSummary}') = 'array'
      THEN payload #> '{carbonResults,factorSourceSummary}'
    WHEN jsonb_typeof(payload #> '{carbonResults,factorSources}') = 'array'
      THEN payload #> '{carbonResults,factorSources}'
    ELSE '[]'::jsonb
  END,
  assumptions = CASE
    WHEN jsonb_typeof(payload #> '{carbonResults,assumptionsUsed}') = 'array'
      THEN payload #> '{carbonResults,assumptionsUsed}'
    ELSE '[]'::jsonb
  END,
  is_legacy = true,
  finalized_at = COALESCE(updated_at, created_at, now())
WHERE finalized_at IS NULL;

ALTER TABLE public.product_assessment_snapshots
  ALTER COLUMN engine_version SET NOT NULL,
  ALTER COLUMN methodology_version SET NOT NULL,
  ALTER COLUMN factor_registry_version SET NOT NULL,
  ALTER COLUMN gwp_basis SET NOT NULL,
  ALTER COLUMN calculated_at SET NOT NULL,
  ALTER COLUMN canonical_input_hash SET NOT NULL;

ALTER TABLE public.product_assessment_snapshots
  DROP CONSTRAINT IF EXISTS product_assessment_snapshots_product_id_key;

ALTER TABLE public.product_assessment_snapshots
  DROP CONSTRAINT IF EXISTS product_assessment_snapshots_product_version_key;

ALTER TABLE public.product_assessment_snapshots
  ADD CONSTRAINT product_assessment_snapshots_product_version_key
  UNIQUE (product_id, version);

ALTER TABLE public.product_assessment_snapshots
  DROP CONSTRAINT IF EXISTS product_assessment_snapshots_version_positive;

ALTER TABLE public.product_assessment_snapshots
  ADD CONSTRAINT product_assessment_snapshots_version_positive CHECK (version > 0);

CREATE INDEX IF NOT EXISTS idx_product_snapshots_latest
  ON public.product_assessment_snapshots(product_id, version DESC);

CREATE OR REPLACE VIEW public.latest_product_assessment_snapshots AS
SELECT DISTINCT ON (product_id) *
FROM public.product_assessment_snapshots
ORDER BY product_id, version DESC, calculated_at DESC, created_at DESC;

CREATE OR REPLACE FUNCTION public.reject_finalized_calculation_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'Finalized calculation snapshot % is immutable', OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_snapshot_immutable
  ON public.product_assessment_snapshots;

CREATE TRIGGER trg_product_snapshot_immutable
BEFORE UPDATE ON public.product_assessment_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.reject_finalized_calculation_snapshot_update();

ALTER TABLE public.carbon_calculations
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT,
  ADD COLUMN IF NOT EXISTS factor_registry_version TEXT,
  ADD COLUMN IF NOT EXISTS gwp_basis TEXT,
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canonical_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS factor_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

UPDATE public.carbon_calculations
SET
  engine_version = COALESCE(NULLIF(emission_factor_version, ''), 'legacy-unversioned'),
  methodology_version = COALESCE(NULLIF(methodology, ''), 'legacy-unversioned'),
  factor_registry_version = 'legacy-unversioned',
  gwp_basis = 'legacy-unversioned',
  calculated_at = COALESCE(created_at, now()),
  canonical_input_hash = 'legacy:' || id::text,
  is_legacy = true,
  finalized_at = COALESCE(created_at, now())
WHERE finalized_at IS NULL;

ALTER TABLE public.carbon_calculations
  ALTER COLUMN engine_version SET NOT NULL,
  ALTER COLUMN methodology_version SET NOT NULL,
  ALTER COLUMN factor_registry_version SET NOT NULL,
  ALTER COLUMN gwp_basis SET NOT NULL,
  ALTER COLUMN calculated_at SET NOT NULL,
  ALTER COLUMN canonical_input_hash SET NOT NULL;

DROP TRIGGER IF EXISTS trg_carbon_calculation_immutable
  ON public.carbon_calculations;

CREATE TRIGGER trg_carbon_calculation_immutable
BEFORE UPDATE ON public.carbon_calculations
FOR EACH ROW
EXECUTE FUNCTION public.reject_finalized_calculation_snapshot_update();
