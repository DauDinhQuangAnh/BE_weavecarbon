#!/usr/bin/env node

require('dotenv').config();
const pool = require('../src/config/database');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function collectPlanNodes(node, result = { nodeTypes: [], indexes: [] }) {
  if (!node || typeof node !== 'object') return result;
  if (node['Node Type']) result.nodeTypes.push(node['Node Type']);
  if (node['Index Name']) result.indexes.push(node['Index Name']);
  for (const child of node.Plans || []) collectPlanNodes(child, result);
  return result;
}

async function explain(name, sql, params) {
  const result = await pool.query(`EXPLAIN (FORMAT JSON, COSTS TRUE) ${sql}`, params);
  const plan = result.rows[0]['QUERY PLAN'][0].Plan;
  const nodes = collectPlanNodes(plan);
  return {
    name,
    totalCost: plan['Total Cost'],
    estimatedRows: plan['Plan Rows'],
    nodeTypes: Array.from(new Set(nodes.nodeTypes)),
    indexes: Array.from(new Set(nodes.indexes))
  };
}

async function main() {
  const companyResult = await pool.query('SELECT id FROM companies ORDER BY id LIMIT 1');
  const companyId = companyResult.rows[0]?.id || ZERO_UUID;
  const productResult = await pool.query(
    'SELECT id FROM products WHERE company_id = $1 ORDER BY id LIMIT 1',
    [companyId]
  );
  const productId = productResult.rows[0]?.id || ZERO_UUID;

  const plans = await Promise.all([
    explain('products-active-by-updated', `
      SELECT id, sku, name, status, total_co2e, updated_at
      FROM products
      WHERE company_id = $1 AND status <> 'archived'
      ORDER BY updated_at DESC LIMIT 20`, [companyId]),
    explain('latest-product-snapshot', `
      SELECT id, version, calculated_at, factor_registry_version
      FROM product_assessment_snapshots
      WHERE company_id = $1 AND product_id = $2
      ORDER BY version DESC LIMIT 1`, [companyId, productId]),
    explain('evidence-feed', `
      SELECT id, document_name, status, created_at
      FROM evidence_documents
      WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`, [companyId]),
    explain('supplier-status-feed', `
      SELECT id, supplier_name, status, created_at
      FROM supplier_requests
      WHERE company_id = $1 AND status = 'waiting'
      ORDER BY created_at DESC LIMIT 50`, [companyId]),
    explain('carbon-history', `
      SELECT id, product_id, calculation_type, total_co2e, created_at
      FROM carbon_calculations
      WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100`, [companyId]),
    explain('product-batches-feed', `
      SELECT id, batch_number, status, updated_at
      FROM product_batches
      WHERE company_id = $1 ORDER BY updated_at DESC LIMIT 20`, [companyId])
  ]);

  console.log(JSON.stringify({ auditedAt: new Date().toISOString(), plans }, null, 2));
}

main()
  .catch((error) => {
    console.error('[db-audit] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => pool.end().catch(() => {}));
