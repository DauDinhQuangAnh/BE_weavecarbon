const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '021_export_container_hierarchy_pdf.sql'),
  'utf8'
);

describe('export container hierarchy and PDF migration contract', () => {
  test('adds tenant-scoped containers and package hierarchy without replacing data', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.shipment_containers');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS container_id UUID');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS parent_package_id UUID');
    expect(sql).toContain('fk_shipment_packages_container_tenant');
    expect(sql).toContain('fk_shipment_packages_parent_tenant');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });

  test('stores and protects the immutable output format', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS output_format TEXT');
    expect(sql).toContain("output_format IN ('xlsx', 'pdf', 'csv')");
    expect(sql).toContain('NEW.output_format IS DISTINCT FROM OLD.output_format');
    expect(sql).toContain('NEW.mime_type IS DISTINCT FROM OLD.mime_type');
  });
});
