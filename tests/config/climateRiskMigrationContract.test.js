const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/045_g2_climate_risk_screening.sql'), 'utf8');

test('G2-07 screening records are tenant-bound, immutable and indexed', () => {
  for (const table of ['climate_risk_location_revisions','climate_risk_assessments','climate_risk_portfolio_snapshots','climate_risk_portfolio_members']) {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
  }
  expect(sql).toContain('FOREIGN KEY (location_revision_id, company_id, facility_revision_id)');
  expect(sql).toContain('FOREIGN KEY (assessment_id, company_id, facility_revision_id, hazard_type)');
  expect(sql).toContain('idx_climate_assessment_scenario');
  expect((sql.match(/BEFORE UPDATE OR DELETE/g) || []).length).toBe(4);
});
