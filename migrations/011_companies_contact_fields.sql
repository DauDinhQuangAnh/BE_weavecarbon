-- Add contact/identity fields to companies table for CBAM report usage
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS tax_id  TEXT,
  ADD COLUMN IF NOT EXISTS phone   TEXT;
