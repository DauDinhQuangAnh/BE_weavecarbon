const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/039_g2_industrial_activity_review.sql'), 'utf8');

describe('G2 industrial activity review migration contract', () => {
  test('creates a tenant-bound immutable review ledger', () => {
    expect(sql).toContain('industrial_activity_reviews');
    expect(sql).toContain('REFERENCES public.industrial_activity_records(id, company_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
  });

  test('snapshots source provenance and evidence', () => {
    expect(sql).toContain('source_sha256');
    expect(sql).toContain('evidence_snapshot');
    expect(sql).toContain("'approved', 'needs_information', 'rejected'");
  });
});
