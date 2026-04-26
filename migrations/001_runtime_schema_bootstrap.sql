ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS domestic_market TEXT;

UPDATE public.companies
SET domestic_market = CASE
  WHEN domestic_market IS NOT NULL AND BTRIM(domestic_market) <> '' THEN UPPER(BTRIM(domestic_market))
  WHEN array_length(target_markets, 1) > 0 THEN UPPER(BTRIM(target_markets[1]))
  ELSE 'VN'
END
WHERE domestic_market IS NULL OR BTRIM(domestic_market) = '';

ALTER TABLE public.companies
ALTER COLUMN domestic_market SET DEFAULT 'VN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'pricing_plan'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'pricing_plan'
        AND e.enumlabel = 'standard_20'
    ) THEN
      ALTER TYPE public.pricing_plan ADD VALUE 'standard_20';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'pricing_plan'
        AND e.enumlabel = 'standard_35'
    ) THEN
      ALTER TYPE public.pricing_plan ADD VALUE 'standard_35';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'pricing_plan'
        AND e.enumlabel = 'standard_50'
    ) THEN
      ALTER TYPE public.pricing_plan ADD VALUE 'standard_50';
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_cycles (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  trial_started_at TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ NOT NULL,
  standard_started_at TIMESTAMPTZ,
  standard_expires_at TIMESTAMPTZ,
  standard_sku_limit INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription_cycles'
      AND column_name = 'starter_trial_started_at'
  ) THEN
    UPDATE public.subscription_cycles
    SET trial_started_at = COALESCE(trial_started_at, starter_trial_started_at),
        trial_ends_at = COALESCE(trial_ends_at, starter_trial_ends_at)
    WHERE trial_started_at IS NULL OR trial_ends_at IS NULL;
  END IF;
END $$;

UPDATE public.subscription_cycles
SET trial_started_at = COALESCE(trial_started_at, NOW()),
    trial_ends_at = COALESCE(trial_ends_at, NOW() + INTERVAL '14 days')
WHERE trial_started_at IS NULL OR trial_ends_at IS NULL;

ALTER TABLE public.subscription_cycles
ALTER COLUMN trial_started_at SET NOT NULL;

ALTER TABLE public.subscription_cycles
ALTER COLUMN trial_ends_at SET NOT NULL;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS standard_started_at TIMESTAMPTZ;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS standard_expires_at TIMESTAMPTZ;

ALTER TABLE public.subscription_cycles
ADD COLUMN IF NOT EXISTS standard_sku_limit INTEGER NOT NULL DEFAULT 0;

UPDATE public.companies
SET current_plan = 'trial'
WHERE current_plan::text NOT IN ('trial', 'standard', 'standard_20', 'standard_35', 'standard_50', 'export');

CREATE TABLE IF NOT EXISTS public.subscription_payment_sessions (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_plan pricing_plan NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  payment_provider TEXT NOT NULL DEFAULT 'vnpay',
  amount BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled', 'expired')),
  payment_url TEXT,
  gateway_transaction_ref TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shipments
ADD COLUMN IF NOT EXISTS pending_until TIMESTAMPTZ;

ALTER TABLE public.shipments
ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ;

ALTER TABLE public.shipments
ADD COLUMN IF NOT EXISTS actual_arrival_at TIMESTAMPTZ;

ALTER TABLE public.shipments
ADD COLUMN IF NOT EXISTS simulation_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.product_compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  compliance_document_id UUID NOT NULL REFERENCES public.compliance_documents(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL,
  storage_key_snapshot TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'batch_publish')),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, compliance_document_id)
);
