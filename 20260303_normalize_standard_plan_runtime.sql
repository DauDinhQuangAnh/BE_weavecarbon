BEGIN;

-- Normalize legacy Standard package aliases to the canonical runtime plan id.
UPDATE public.companies
SET current_plan = 'standard',
    updated_at = NOW()
WHERE current_plan::text IN ('standard_20', 'standard_35', 'standard_50');

-- Keep payment sessions canonical as well. SKU increments stay in metadata.
UPDATE public.subscription_payment_sessions
SET target_plan = 'standard',
    updated_at = NOW()
WHERE target_plan::text IN ('standard_20', 'standard_35', 'standard_50');

COMMIT;
