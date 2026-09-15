const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/040_g2_dql_factor_governance.sql'), 'utf8');

describe('G2-02 data-quality governance migration', () => {
  test('creates immutable DQL and factor governance ledgers', () => {
    expect(sql).toContain('industrial_dql_assessments');
    expect(sql).toContain('emission_factor_proposals');
    expect(sql).toContain('emission_factor_proposal_reviews');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(3);
  });
  test('preserves scoring, provenance and tenant-bound review evidence', () => {
    expect(sql).toContain('methodology_version'); expect(sql).toContain('assessment_sha256');
    expect(sql).toContain('REFERENCES public.emission_factor_proposals(id, company_id)');
    expect(sql).toContain('evidence_snapshot');
  });
});
