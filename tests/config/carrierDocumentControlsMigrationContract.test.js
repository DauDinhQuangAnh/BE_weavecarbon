const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '024_r03_carrier_document_controls.sql'),
  'utf8'
);

describe('R03 carrier document controls migration contract', () => {
  test.each(['shipment_carrier_documents', 'carrier_document_reconciliations'])(
    'creates additive %s records',
    (table) => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  );

  test('binds carrier metadata to the exact tenant, shipment and evidence file', () => {
    expect(sql).toContain('FOREIGN KEY (company_id, shipment_id, evidence_document_id)');
    expect(sql).toContain('REFERENCES public.evidence_documents(company_id, shipment_id, id)');
    expect(sql).toContain('source_snapshot_sha256 TEXT NOT NULL');
    expect(sql).toContain('metadata_confirmer_name_snapshot TEXT');
    expect(sql).toContain('trg_shipment_carrier_documents_immutable');
    expect(sql).toContain('trg_carrier_document_reconciliations_append_only');
  });

  test('adds Carbon Annex authority identity without destructive data operations', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS carbon_snapshot_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS carbon_methodology_version');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS carbon_factor_snapshot');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
