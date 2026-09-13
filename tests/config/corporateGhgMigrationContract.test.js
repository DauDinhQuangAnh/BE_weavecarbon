const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/036_r13_corporate_ghg_inventory.sql'), 'utf8');

describe('R13 corporate GHG migration contract', () => {
  test('creates tenant-bound immutable inventory revisions and reviews', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.corporate_ghg_inventory_revisions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.corporate_ghg_inventory_reviews');
    expect(sql).toContain('UNIQUE(company_id, inventory_reference, revision)');
    expect(sql).toContain('activity_snapshot_sha256');
  });

  test('binds reviews to inventories and named reviewer roles', () => {
    expect(sql).toContain('REFERENCES public.corporate_ghg_inventory_revisions(id, company_id)');
    expect(sql).toContain("reviewer_role = 'corporate_ghg_inventory_reviewer'");
    expect(sql).toContain("'approved_for_internal_report', 'needs_information', 'rejected'");
  });

  test('rejects updates and deletes from both ledgers', () => {
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(2);
    expect(sql).toMatch(/append-only and immutable/i);
  });
});
