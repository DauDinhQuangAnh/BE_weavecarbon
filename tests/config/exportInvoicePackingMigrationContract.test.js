const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '018_export_invoice_packing_details.sql'),
  'utf8'
);

describe('invoice and packing details migration contract', () => {
  test.each([
    'invoice_issue_place',
    'packing_list_number',
    'packing_list_date',
    'discount_amount',
    'surcharge_amount',
    'transport_mode',
    'style_code',
    'size_label',
    'color_label',
    'lot_number',
    'hs_code_confirmed',
    'hs_code_confirmed_by',
    'hs_code_confirmed_at'
  ])('adds %s without replacing existing data', (column) => {
    expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
  });

  test('is additive and protects monetary adjustments', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).toContain('discount_amount IS NULL OR discount_amount >= 0');
    expect(sql).toContain('surcharge_amount IS NULL OR surcharge_amount >= 0');
  });
});
