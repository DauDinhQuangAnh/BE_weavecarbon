const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '025_r04_vn_customs_broker_handoff.sql'),
  'utf8'
);

describe('R04 Vietnam customs broker handoff migration contract', () => {
  test.each(['shipment_vn_customs_profiles', 'vn_customs_external_events'])(
    'creates additive %s records',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('adds the handoff document and customs reviewer without changing issued bytes', () => {
    expect(sql).toContain("'vn_customs_handoff'");
    expect(sql).toContain("'customs_declaration_reviewer'");
    expect(sql).toContain('REFERENCES public.export_documents(id, company_id, shipment_id)');
  });

  test('requires evidence-bound append-only external events', () => {
    expect(sql).toContain('evidence_sha256 TEXT NOT NULL');
    expect(sql).toContain('document_payload_sha256 TEXT NOT NULL');
    expect(sql).toContain('document_file_sha256 TEXT NOT NULL');
    expect(sql).toContain('trg_vn_customs_external_events_append_only');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
