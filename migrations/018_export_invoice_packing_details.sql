-- Additive Commercial Invoice and Packing List details.

ALTER TABLE public.shipment_export_profiles
  ADD COLUMN IF NOT EXISTS invoice_issue_place TEXT,
  ADD COLUMN IF NOT EXISTS packing_list_number TEXT,
  ADD COLUMN IF NOT EXISTS packing_list_date DATE,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS surcharge_amount NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS transport_mode TEXT;

ALTER TABLE public.shipment_export_lines
  ADD COLUMN IF NOT EXISTS style_code TEXT,
  ADD COLUMN IF NOT EXISTS size_label TEXT,
  ADD COLUMN IF NOT EXISTS color_label TEXT,
  ADD COLUMN IF NOT EXISTS lot_number TEXT,
  ADD COLUMN IF NOT EXISTS hs_code_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hs_code_confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hs_code_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.shipment_export_profiles
  DROP CONSTRAINT IF EXISTS chk_export_profile_discount_nonnegative;
ALTER TABLE public.shipment_export_profiles
  ADD CONSTRAINT chk_export_profile_discount_nonnegative
  CHECK (discount_amount IS NULL OR discount_amount >= 0);

ALTER TABLE public.shipment_export_profiles
  DROP CONSTRAINT IF EXISTS chk_export_profile_surcharge_nonnegative;
ALTER TABLE public.shipment_export_profiles
  ADD CONSTRAINT chk_export_profile_surcharge_nonnegative
  CHECK (surcharge_amount IS NULL OR surcharge_amount >= 0);

