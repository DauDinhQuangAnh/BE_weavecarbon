-- Phase 08: supplier_requests, data_gaps, audit_trail tables
-- Additive only: no existing tables are modified or dropped.

-- =============================================
-- supplier_requests
-- FE /api/suppliers endpoint — tracks Scope 3 data collection requests
-- (distinct from the general `suppliers` company-catalog table)
-- =============================================
CREATE TABLE IF NOT EXISTS public.supplier_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  supplier_email TEXT NOT NULL,
  material_supplied TEXT,
  required_data TEXT[] NOT NULL DEFAULT '{}',
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'waiting', 'received', 'overdue')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_requests_company
  ON public.supplier_requests(company_id);

CREATE INDEX IF NOT EXISTS idx_supplier_requests_status
  ON public.supplier_requests(company_id, status);


-- =============================================
-- data_gaps
-- FE /api/data-gaps endpoint — tracks missing Scope 3 data items per company
-- =============================================
CREATE TABLE IF NOT EXISTS public.data_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  data_group TEXT NOT NULL,
  required_for_audit BOOLEAN NOT NULL DEFAULT true,
  current_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (current_status IN ('missing', 'proxy', 'self_declared', 'uploaded', 'verified')),
  risk_level TEXT NOT NULL DEFAULT 'high'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  required_action TEXT,
  owner TEXT,
  deadline DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_gaps_company
  ON public.data_gaps(company_id);

CREATE INDEX IF NOT EXISTS idx_data_gaps_status
  ON public.data_gaps(company_id, current_status);


-- =============================================
-- audit_trail
-- FE /api/audit-trail endpoint — immutable log of data changes per company.
-- Rows are INSERT-only; no UPDATE/DELETE.
-- =============================================
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evidence_document_id UUID REFERENCES public.evidence_documents(id) ON DELETE SET NULL,
  data_group TEXT NOT NULL,
  changed_field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  notes TEXT,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_company_created
  ON public.audit_trail(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_trail_evidence
  ON public.audit_trail(evidence_document_id)
  WHERE evidence_document_id IS NOT NULL;
