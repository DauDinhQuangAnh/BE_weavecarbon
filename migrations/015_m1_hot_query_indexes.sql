-- no-transaction
-- M1 / WP-D1: indexes justified by current dashboard, product, snapshot,
-- evidence, supplier and carbon-history query shapes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_company_active_updated
  ON public.products (company_id, updated_at DESC)
  WHERE status <> 'archived';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_snapshots_company_product_version
  ON public.product_assessment_snapshots (company_id, product_id, version DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_company_created
  ON public.evidence_documents (company_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_requests_company_status_created
  ON public.supplier_requests (company_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carbon_calculations_company_created
  ON public.carbon_calculations (company_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_batches_company_updated
  ON public.product_batches (company_id, updated_at DESC);
