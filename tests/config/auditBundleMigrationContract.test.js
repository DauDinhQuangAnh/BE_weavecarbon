const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '019_immutable_audit_bundles.sql'),
  'utf8'
);

describe('immutable Audit Pack migration contract', () => {
  test.each(['audit_bundles', 'audit_bundle_evidence'])(
    'creates %s additively',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('pins calculation and evidence identity and prevents completed mutation', () => {
    expect(sql).toContain('calculation_snapshot_id UUID NOT NULL');
    expect(sql).toContain('checksum_sha256 TEXT NOT NULL');
    expect(sql).toContain('trg_audit_bundles_immutable');
    expect(sql).toContain('trg_audit_bundle_evidence_immutable');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON public.audit_bundle_evidence');
    expect(sql).toContain('Completed audit bundles are immutable');
  });

  test('contains no destructive migration operation', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
