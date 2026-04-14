CREATE TABLE IF NOT EXISTS public.analytics_outbox (
  id UUID PRIMARY KEY,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'server',
  user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  analytics_user_key TEXT NULL,
  analytics_company_key TEXT NULL,
  entity_type TEXT NULL,
  entity_id TEXT NULL,
  value NUMERIC(12, 2) NULL,
  currency TEXT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_outbox_delivery_status
  ON public.analytics_outbox (delivery_status, occurred_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_analytics_outbox_company_event
  ON public.analytics_outbox (company_id, event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_outbox_user_event
  ON public.analytics_outbox (user_id, event_name, occurred_at DESC);
