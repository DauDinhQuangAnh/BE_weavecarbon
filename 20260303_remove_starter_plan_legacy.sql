BEGIN;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

UPDATE public.subscription_cycles
SET
  trial_started_at = COALESCE(
    trial_started_at,
    starter_trial_started_at,
    created_at,
    NOW()
  ),
  trial_ends_at = COALESCE(
    trial_ends_at,
    starter_trial_ends_at,
    COALESCE(trial_started_at, starter_trial_started_at, created_at, NOW()) + INTERVAL '14 days'
  )
WHERE
  trial_started_at IS NULL OR
  trial_ends_at IS NULL;

ALTER TABLE public.subscription_cycles
ALTER COLUMN trial_started_at SET NOT NULL;

ALTER TABLE public.subscription_cycles
ALTER COLUMN trial_ends_at SET NOT NULL;

UPDATE public.companies
SET current_plan = 'trial'
WHERE current_plan::text = 'starter';

DO $$
BEGIN
  IF to_regclass('public.subscription_payment_sessions') IS NOT NULL THEN
    EXECUTE '
      UPDATE public.subscription_payment_sessions
      SET target_plan = ''trial''
      WHERE target_plan::text = ''starter''
    ';
  END IF;
END $$;

DROP TYPE IF EXISTS public.pricing_plan_new;

CREATE TYPE public.pricing_plan_new AS ENUM (
  'trial',
  'standard',
  'standard_20',
  'standard_35',
  'standard_50',
  'export'
);

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ns.nspname AS schema_name,
      cls.relname AS table_name,
      att.attname AS column_name
    FROM pg_attribute att
    JOIN pg_class cls ON cls.oid = att.attrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_type typ ON typ.oid = att.atttypid
    WHERE ns.nspname = 'public'
      AND typ.typname = 'pricing_plan'
      AND att.attnum > 0
      AND NOT att.attisdropped
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
      rec.schema_name,
      rec.table_name,
      rec.column_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.pricing_plan_new USING (CASE WHEN %I::text = %L THEN %L ELSE %I::text END)::public.pricing_plan_new',
      rec.schema_name,
      rec.table_name,
      rec.column_name,
      rec.column_name,
      'starter',
      'trial',
      rec.column_name
    );
  END LOOP;
END $$;

DROP TYPE public.pricing_plan;
ALTER TYPE public.pricing_plan_new RENAME TO pricing_plan;

ALTER TABLE public.companies
ALTER COLUMN current_plan SET DEFAULT 'trial';

ALTER TABLE public.subscription_cycles
DROP COLUMN IF EXISTS starter_trial_started_at;

ALTER TABLE public.subscription_cycles
DROP COLUMN IF EXISTS starter_trial_ends_at;

COMMIT;
