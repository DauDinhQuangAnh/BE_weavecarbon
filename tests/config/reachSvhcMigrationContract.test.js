const fs = require('fs');
const path = require('path');

describe('R11 REACH/SVHC migration contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/034_r11_reach_svhc_dossier.sql'), 'utf8');

  test('stores tenant-bound immutable revisions, reviews and obligation events', () => {
    expect(sql).toContain('reach_svhc_dossier_revisions');
    expect(sql).toContain('reach_svhc_dossier_reviews');
    expect(sql).toContain('reach_obligation_events');
    expect(sql).toContain('FOREIGN KEY (dossier_id, company_id, shipment_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
  });

  test('requires external proof for outbound claims and prohibits consumer data', () => {
    expect(sql).toContain("'article7_notification'");
    expect(sql).toContain("'scip_notification'");
    expect(sql).toContain('external_reference IS NOT NULL');
    expect(sql).toContain('consumer_personal_data_included = false');
  });

  test('indexes tenant, source dates, deadlines and non-leading foreign keys', () => {
    for (const name of ['idx_reach_svhc_dossiers_tenant', 'idx_reach_svhc_dossiers_source_dates',
      'idx_reach_svhc_reviews_reviewer', 'idx_reach_obligation_events_due', 'idx_reach_obligation_events_evidence']) {
      expect(sql).toContain(name);
    }
  });
});
