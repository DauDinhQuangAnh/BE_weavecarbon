const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '022_export_document_business_review.sql'),
  'utf8'
);

describe('export document business review migration contract', () => {
  test.each([
    'importer_vat_id',
    'carrier_name',
    'customs_value_amount',
    'customs_value_basis',
    'hs_code_source',
    'hs_code_ruleset',
    'hs_code_effective_date',
    'weight_measurement_basis',
    'dimension_measurement_basis'
  ])('adds %s without replacing existing data', (column) => {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
  });

  test('creates tenant-bound append-only reviews pinned to all three hashes', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.export_document_reviews');
    expect(sql).toContain('document_payload_sha256 TEXT NOT NULL');
    expect(sql).toContain('document_file_sha256 TEXT NOT NULL');
    expect(sql).toContain('source_snapshot_sha256 TEXT NOT NULL');
    expect(sql).toContain('reviewer_name_snapshot TEXT NOT NULL');
    expect(sql).toContain('reject_export_document_review_mutation');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
