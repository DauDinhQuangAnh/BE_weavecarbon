-- Migration 008: electricity_invoices and fuel_invoices tables
-- Used by CBAM report page for Scope 1 & 2 emission tracking

CREATE TABLE IF NOT EXISTS public.electricity_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_name TEXT NOT NULL DEFAULT 'Main Facility',
  billing_period TEXT NOT NULL,
  kwh NUMERIC(12, 2) NOT NULL DEFAULT 0,
  emission_factor_kg_per_kwh NUMERIC(10, 6) NOT NULL DEFAULT 0.4290,
  emission_factor_source TEXT DEFAULT 'VN Ministry of Natural Resources 2024',
  scope2_co2e_kg NUMERIC(12, 4) GENERATED ALWAYS AS (kwh * emission_factor_kg_per_kwh) STORED,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'reviewed', 'verified', 'rejected')),
  evidence_document_id UUID REFERENCES public.evidence_documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_electricity_invoices_company
  ON public.electricity_invoices(company_id);

CREATE INDEX IF NOT EXISTS idx_electricity_invoices_period
  ON public.electricity_invoices(company_id, billing_period);

CREATE TABLE IF NOT EXISTS public.fuel_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_period TEXT NOT NULL,
  fuel_type TEXT NOT NULL DEFAULT 'diesel'
    CHECK (fuel_type IN ('diesel', 'petrol', 'lpg', 'cng', 'coal', 'biomass', 'other')),
  quantity_liters NUMERIC(12, 3) NOT NULL DEFAULT 0,
  emission_factor_kg_per_liter NUMERIC(10, 6),
  scope1_co2e_kg NUMERIC(12, 4),
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'reviewed', 'verified', 'rejected')),
  evidence_document_id UUID REFERENCES public.evidence_documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_invoices_company
  ON public.fuel_invoices(company_id);

CREATE INDEX IF NOT EXISTS idx_fuel_invoices_period
  ON public.fuel_invoices(company_id, billing_period);
