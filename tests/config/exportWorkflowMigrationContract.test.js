const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '017_shipment_export_workflow.sql'),
  'utf8'
);

describe('shipment export workflow migration contract', () => {
  test.each([
    'shipment_export_profiles',
    'shipment_export_lines',
    'shipment_packages',
    'export_documents',
    'export_requirement_results'
  ])('creates %s additively', (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
  });

  test('keeps issued documents versioned and linked to their predecessor', () => {
    expect(sql).toContain("'draft', 'blocked', 'ready', 'issued', 'superseded', 'failed'");
    expect(sql).toContain('supersedes_id UUID REFERENCES public.export_documents');
    expect(sql).toContain('UNIQUE(shipment_id, document_type, version)');
    expect(sql).toContain('trg_export_documents_immutable');
    expect(sql).toContain('Issued export document content is immutable');
  });

  test('adds evidence approval/validity fields without dropping legacy data', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS valid_from DATE');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS valid_to DATE');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS approved_by UUID');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
