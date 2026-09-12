const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '027_r05_eu_import_declarant_handoff.sql'),
  'utf8'
);

describe('R05 EU import declarant handoff migration contract', () => {
  test.each(['shipment_eu_import_profiles', 'shipment_eu_import_line_details', 'eu_import_external_events'])(
    'creates additive %s records',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('adds the handoff document and named reviewer without changing issued bytes', () => {
    expect(sql).toContain("'eu_import_handoff'");
    expect(sql).toContain("'eu_import_declaration_reviewer'");
    expect(sql).toContain('REFERENCES public.export_documents(id, company_id, shipment_id)');
  });

  test('binds line classification to tenant and makes external events append-only', () => {
    expect(sql).toContain('REFERENCES public.shipment_export_lines(id, company_id, shipment_id)');
    expect(sql).toContain('taric_confirmed_by UUID');
    expect(sql).toContain('trg_eu_import_external_events_append_only');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
