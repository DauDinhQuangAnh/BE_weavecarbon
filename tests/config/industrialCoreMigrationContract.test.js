const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/038_g2_industrial_core_baseline.sql'), 'utf8');

describe('G2 industrial core migration contract', () => {
  test('creates the canonical facility, process, measurement and activity records', () => {
    expect(sql).toContain('industrial_facility_revisions');
    expect(sql).toContain('industrial_process_revisions');
    expect(sql).toContain('industrial_measurement_point_revisions');
    expect(sql).toContain('industrial_activity_records');
    expect(sql).toContain('industrial_activity_evidence');
  });

  test('uses tenant-bound foreign keys and immutable ledgers', () => {
    expect(sql).toContain('REFERENCES public.industrial_facility_revisions(id, company_id)');
    expect(sql).toContain('REFERENCES public.evidence_documents(id, company_id)');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(5);
    expect(sql).toMatch(/append-only and immutable/i);
  });

  test('requires data quality and provenance fields on activity records', () => {
    expect(sql).toContain("data_quality_level IN ('L1', 'L2', 'L3', 'L4', 'L5')");
    expect(sql).toMatch(/source_sha256.*\^\[a-f0-9\]\{64\}/i);
  });
});
