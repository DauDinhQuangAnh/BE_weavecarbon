-- Weave Carbon v2 audit-ready/report/export persistence.
-- Additive only: this migration does not modify existing product/report/export tables.

CREATE TABLE IF NOT EXISTS public.evidence_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  lookup_code TEXT,
  source_vendor TEXT,
  reporting_period_start DATE,
  reporting_period_end DATE,
  storage_provider TEXT NOT NULL DEFAULT 'local',
  storage_bucket TEXT,
  storage_key TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  extracted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'reviewed', 'locked', 'rejected')),
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_documents_company ON public.evidence_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_product ON public.evidence_documents(product_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_lookup ON public.evidence_documents(company_id, lookup_code);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_payload ON public.evidence_documents USING GIN (extracted_json);

CREATE TABLE IF NOT EXISTS public.export_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customs_declaration_no TEXT,
  po_contract_id TEXT,
  bill_of_lading_no TEXT,
  container_no TEXT,
  barcode_standard TEXT NOT NULL DEFAULT 'GS1-Digital',
  buyer_brand TEXT,
  buyer_webhook_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

CREATE TABLE IF NOT EXISTS public.dpp_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  gtin TEXT,
  barcode_standard TEXT NOT NULL DEFAULT 'GS1-Digital',
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  decentralized_url TEXT NOT NULL,
  qr_svg_storage_key TEXT,
  qr_png_storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'revoked')),
  locked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, sku, payload_sha256)
);

CREATE INDEX IF NOT EXISTS idx_dpp_locks_company ON public.dpp_locks(company_id);
CREATE INDEX IF NOT EXISTS idx_dpp_locks_product ON public.dpp_locks(product_id);
CREATE INDEX IF NOT EXISTS idx_dpp_locks_payload ON public.dpp_locks USING GIN (payload);

CREATE TABLE IF NOT EXISTS public.report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  report_template_id UUID REFERENCES public.report_templates(id) ON DELETE SET NULL,
  sku TEXT,
  snapshot_type TEXT NOT NULL DEFAULT 'weave_carbon_v2',
  payload JSONB NOT NULL,
  style_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  chart_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  formulas JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_snapshots_company ON public.report_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_product ON public.report_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_payload ON public.report_snapshots USING GIN (payload);

INSERT INTO public.report_templates (template_key, version, title, config)
VALUES (
  'WEAVE_CARBON_TEMPLATE_v2.0',
  '2.0',
  'WEAVE CARBON v2.0 - Product Carbon & ESG Compliance',
  '{
    "tabs": ["Tong quan", "Nhap lieu", "ISO 14067", "ESG TT01", "CBAM EU"],
    "officialCbamTabs": ["A_INSTDATA", "B_EMINST", "C_EMISSIONS_ENERGY", "D_PROCESSES", "E_PURCHPREC", "SUMMARY_COMMUNICATION"],
    "colors": {
      "primary": "#1B4332",
      "secondary": "#2D6A4F",
      "success": "#0B8F54",
      "warning": "#FFD166",
      "danger": "#9B2226",
      "dangerSoft": "#FDE2E2",
      "formula": "#F4F6F7",
      "input": "#FFFFFF"
    },
    "sources": ["Higg MSI v3.10", "Ecoinvent v3.10", "UK DEFRA 2024", "Bo TN&MT VN", "ISO 14067:2018", "EU Reg 2023/1773 - DG TAXUD CBAM"]
  }'::jsonb
)
ON CONFLICT (template_key) DO UPDATE
SET version = EXCLUDED.version,
    title = EXCLUDED.title,
    config = EXCLUDED.config,
    is_active = true,
    updated_at = now();
