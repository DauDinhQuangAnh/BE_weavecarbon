const fs = require('fs');
const path = require('path');

describe('R18 environmental claim migration contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/031_r18_environmental_claim_register.sql'), 'utf8');

  test('stores tenant-bound immutable dossier revisions and reviews', () => {
    expect(sql).toContain('environmental_claim_dossiers');
    expect(sql).toContain('environmental_claim_reviews');
    expect(sql).toContain('UNIQUE(company_id, shipment_id, claim_reference, revision)');
    expect(sql).toContain('FOREIGN KEY (shipment_id, company_id)');
    expect(sql).toContain('FOREIGN KEY (dossier_id, company_id, shipment_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
  });

  test('indexes tenant queries and non-leading reviewer foreign keys', () => {
    expect(sql).toContain('idx_environmental_claim_dossiers_tenant');
    expect(sql).toContain('idx_environmental_claim_dossiers_created_by');
    expect(sql).toContain('idx_environmental_claim_reviews_reviewer');
  });
});
