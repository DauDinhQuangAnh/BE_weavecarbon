const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/035_r12_pcf_study_dossier.sql'), 'utf8');

describe('R12 PCF study migration contract', () => {
  test('creates tenant-bound study and practitioner review records', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.pcf_study_revisions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.pcf_study_reviews');
    expect(sql).toContain("reviewer_role = 'pcf_practitioner_reviewer'");
    expect(sql).toContain('FOREIGN KEY (company_id, calculation_snapshot_id)');
  });

  test('binds calculation and evidence hashes', () => {
    expect(sql).toContain('calculation_canonical_input_hash TEXT NOT NULL');
    expect(sql).toContain('evidence_snapshot JSONB NOT NULL');
    expect(sql).toContain('result_sha256 TEXT NOT NULL');
  });

  test('makes revisions and reviews append-only', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reject_pcf_study_mutation()');
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(2);
  });
});
