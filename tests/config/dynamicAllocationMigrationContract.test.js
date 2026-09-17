const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/046_g2_dynamic_allocation_lineage.sql'), 'utf8');

describe('G2 dynamic allocation migration contract', () => {
  test('creates versioned rules, immutable runs and normalized lineage lines', () => {
    expect(sql).toContain('industrial_allocation_rule_revisions');
    expect(sql).toContain('industrial_allocation_runs');
    expect(sql).toContain('industrial_allocation_lines');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(3);
  });

  test('supports only forward facility-process-batch-product allocation levels', () => {
    expect(sql).toContain("source_level = 'facility'");
    expect(sql).toContain("source_level = 'process'");
    expect(sql).toContain("source_level = 'batch'");
    expect(sql).toContain("target_level = 'product'");
  });

  test('requires exact reconciliation and tenant-bound lineage', () => {
    expect(sql).toContain('abs(reconciliation_difference) <= 0.00000001');
    expect(sql).toContain('REFERENCES public.industrial_allocation_lines(id, company_id)');
    expect(sql).toContain('UNIQUE(company_id, payload_sha256)');
  });
});
