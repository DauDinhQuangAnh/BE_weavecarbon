const fs = require('fs');
const path = require('path');

describe('R08 textile fibre label migration contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/032_r08_textile_fibre_label.sql'), 'utf8');

  test('stores tenant-bound immutable specification revisions and reviews', () => {
    expect(sql).toContain('textile_fibre_label_specifications');
    expect(sql).toContain('textile_fibre_label_reviews');
    expect(sql).toContain('UNIQUE(company_id, shipment_id, specification_reference, revision)');
    expect(sql).toContain('FOREIGN KEY (shipment_id, company_id)');
    expect(sql).toContain('FOREIGN KEY (specification_id, company_id, shipment_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
  });

  test('indexes tenant queries and non-leading user foreign keys', () => {
    expect(sql).toContain('idx_textile_fibre_label_specifications_tenant');
    expect(sql).toContain('idx_textile_fibre_label_specifications_created_by');
    expect(sql).toContain('idx_textile_fibre_label_reviews_reviewer');
  });
});
