-- Per-user email notification preferences (Settings → Notifications).
-- Keys are notification ids from the frontend notification config; values are booleans.
-- A missing key means "use the notification's default".

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
