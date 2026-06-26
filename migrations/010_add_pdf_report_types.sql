-- no-transaction
-- Add PDF report sub-types to the report_type enum.
-- ALTER TYPE ADD VALUE cannot run inside a transaction (PostgreSQL restriction),
-- so this migration is marked no-transaction.

ALTER TYPE public.report_type ADD VALUE IF NOT EXISTS 'product_carbon';
ALTER TYPE public.report_type ADD VALUE IF NOT EXISTS 'batch_export';
ALTER TYPE public.report_type ADD VALUE IF NOT EXISTS 'facility_emission';
