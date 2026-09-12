const fs = require('fs');
const path = require('path');

describe('R07 EVFTA origin-support handoff migration contract', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../migrations/029_r07_evfta_origin_support_handoff.sql'), 'utf8'
  );

  test('adds a tenant-bound controlled origin profile without destructive operations', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.shipment_origin_profiles/i);
    expect(sql).toMatch(/weavecarbon\.evfta-origin-support-handoff/i);
    expect(sql).toMatch(/profile_data JSONB NOT NULL/i);
    expect(sql).toMatch(/UNIQUE\(id, company_id, shipment_id\)/i);
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE/i);
  });

  test('adds a specialist review gate for only the support handoff', () => {
    expect(sql).toContain("'origin_workbook'");
    expect(sql).toContain("'origin_specialist_reviewer'");
    expect(sql).toContain("handoff_purpose = 'origin_specialist_review'");
  });
});
