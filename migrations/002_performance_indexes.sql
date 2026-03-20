-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_company_status_updated
  ON public.products (company_id, status, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipments_company_status_updated
  ON public.shipments (company_id, status, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipments_company_simulation
  ON public.shipments (company_id, simulation_enabled, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipment_products_product_shipment
  ON public.shipment_products (product_id, shipment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_company_status_created
  ON public.reports (company_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carbon_targets_company_period
  ON public.carbon_targets (company_id, year, month);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_readiness_company_score
  ON public.market_readiness (company_id, readiness_score DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_export_markets_company_score
  ON public.export_markets (company_id, score DESC, market_name ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_documents_company_market_created
  ON public.compliance_documents (company_id, market_code, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_recommendations_market_priority_created
  ON public.market_recommendations (market_id, priority, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_recommendations_company_open_created
  ON public.ai_recommendations (company_id, is_implemented, created_at DESC);
