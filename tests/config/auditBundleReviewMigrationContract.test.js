const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '020_audit_bundle_review_lifecycle.sql'),
  'utf8'
);

describe('Audit Pack review lifecycle migration contract', () => {
  test.each(['audit_bundle_reviews', 'audit_bundle_issuances'])(
    'creates append-only %s records',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('pins reviewer, issuer, criteria and bundle hashes', () => {
    expect(sql).toContain('factor_version_ids JSONB NOT NULL');
    expect(sql).toContain('calculation_term_numbers JSONB NOT NULL');
    expect(sql).toContain("decision IN ('approved', 'rejected')");
    expect(sql).toContain('qa_exceptions JSONB NOT NULL');
    expect(sql).toContain('assertion_text TEXT NOT NULL');
    expect(sql).toContain('criteria TEXT NOT NULL');
    expect(sql).toContain('manifest_sha256 TEXT NOT NULL');
    expect(sql).toContain('bundle_sha256 TEXT NOT NULL');
    expect(sql).toContain('FOREIGN KEY (company_id, audit_bundle_id)');
    expect(sql).toContain('trg_audit_bundle_reviews_append_only');
    expect(sql).toContain('trg_audit_bundle_issuances_append_only');
  });

  test('contains no destructive table operation', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
