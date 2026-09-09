const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '023_audit_pack_signed_sharing_assurance.sql'),
  'utf8'
);

describe('Audit Pack signed sharing and assurance migration contract', () => {
  test.each(['audit_bundle_share_links', 'audit_bundle_assurance_records'])(
    'creates additive %s records',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('binds signatures, shares and assurance to immutable content identity', () => {
    expect(sql).toContain('signature_payload_sha256 TEXT');
    expect(sql).toContain("signature_algorithm = 'ed25519-weavecarbon-attestation-v1'");
    expect(sql).toContain("token_sha256 TEXT NOT NULL UNIQUE");
    expect(sql).toContain('manifest_sha256 TEXT NOT NULL');
    expect(sql).toContain('bundle_sha256 TEXT NOT NULL');
    expect(sql).toContain('trg_audit_bundle_share_links_guard');
    expect(sql).toContain('trg_audit_bundle_assurance_append_only');
    expect(sql).toContain('FOREIGN KEY (company_id, audit_bundle_id)');
  });

  test('contains no destructive table operation and never stores a plaintext token', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/\btoken\s+TEXT/i);
  });
});
