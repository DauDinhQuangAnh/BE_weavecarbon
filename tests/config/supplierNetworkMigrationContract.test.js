const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/049_g2_supplier_network_criticality.sql'), 'utf8');

test('G2-11 creates tenant-bound immutable supplier and criticality ledgers', () => {
  for (const table of ['industrial_supplier_revisions', 'industrial_supplier_site_revisions',
    'industrial_supplier_relationship_revisions', 'industrial_supplier_climate_assessments',
    'carbon_climate_subject_carbon_snapshots', 'carbon_climate_criticality_model_revisions',
    'carbon_climate_criticality_snapshots', 'carbon_climate_criticality_climate_members',
    'carbon_climate_criticality_portfolio_snapshots', 'carbon_climate_criticality_portfolio_members']) {
    expect(sql).toContain(`public.${table}`);
  }
  expect(sql).toContain("subject_kind IN ('facility','supplier')");
  expect(sql).toContain('carbon_weight_percent + climate_weight_percent + dependency_weight_percent = 100');
  expect((sql.match(/BEFORE UPDATE OR DELETE/g) || [])).toHaveLength(10);
  expect((sql.match(/company_id UUID NOT NULL/g) || []).length).toBeGreaterThanOrEqual(10);
});
