-- Migration 009: carbon_calculations table
-- Stores per-product and per-shipment carbon calculation records

CREATE TABLE IF NOT EXISTS public.carbon_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
  calculation_type TEXT NOT NULL
    CHECK (calculation_type IN ('product', 'shipment', 'facility', 'annual', 'other')),
  period_start DATE,
  period_end DATE,
  materials_co2e NUMERIC(14, 4) NOT NULL DEFAULT 0,
  production_co2e NUMERIC(14, 4) NOT NULL DEFAULT 0,
  transport_co2e NUMERIC(14, 4) NOT NULL DEFAULT 0,
  packaging_co2e NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_co2e NUMERIC(14, 4) NOT NULL DEFAULT 0,
  methodology TEXT,
  emission_factor_version TEXT NOT NULL DEFAULT '2024',
  notes TEXT,
  calculated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carbon_calculations_company
  ON public.carbon_calculations(company_id);

CREATE INDEX IF NOT EXISTS idx_carbon_calculations_product
  ON public.carbon_calculations(product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_carbon_calculations_shipment
  ON public.carbon_calculations(shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_carbon_calculations_period
  ON public.carbon_calculations(company_id, period_start, period_end);
