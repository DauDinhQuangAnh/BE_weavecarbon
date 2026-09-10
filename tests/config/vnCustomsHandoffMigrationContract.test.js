const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '025_r04_vn_customs_broker_handoff.sql'),
  'utf8'
);
const formatSql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '026_r04_export_document_json_format.sql'),
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

  test('permits JSON only by extending the additive export format constraint', () => {
    expect(formatSql).toContain('DROP CONSTRAINT IF EXISTS chk_export_documents_output_format');
    expect(formatSql).toContain("CHECK (output_format IN ('xlsx', 'pdf', 'csv', 'json'))");
    expect(formatSql).not.toMatch(/DROP\s+TABLE/i);
    expect(formatSql).not.toMatch(/TRUNCATE/i);
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
