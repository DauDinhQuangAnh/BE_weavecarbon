ALTER TABLE public.donations
ADD COLUMN IF NOT EXISTS source_image_storage_key TEXT;

ALTER TABLE public.donations
ADD COLUMN IF NOT EXISTS source_image_original_name TEXT;

ALTER TABLE public.donations
ADD COLUMN IF NOT EXISTS source_image_mime_type TEXT;

ALTER TABLE public.donations
ADD COLUMN IF NOT EXISTS source_image_size_bytes INTEGER;

CREATE INDEX IF NOT EXISTS idx_donations_user_created_at
  ON public.donations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reward_transactions_user_created_at
  ON public.reward_transactions (user_id, created_at DESC);
