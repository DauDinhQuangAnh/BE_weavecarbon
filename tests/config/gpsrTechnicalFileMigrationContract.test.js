const fs = require('fs');
const path = require('path');

describe('R10 GPSR migration contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/033_r10_gpsr_technical_file.sql'), 'utf8');

  test('stores tenant-bound immutable files, reviews and post-market events', () => {
    expect(sql).toContain('gpsr_technical_file_revisions');
    expect(sql).toContain('gpsr_technical_file_reviews');
    expect(sql).toContain('gpsr_post_market_events');
    expect(sql).toContain('UNIQUE(company_id, shipment_id, file_reference, revision)');
    expect(sql).toContain('FOREIGN KEY (technical_file_id, company_id, shipment_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
  });

  test('requires external proof for claimed Safety Business Gateway notifications', () => {
    expect(sql).toContain("event_type <> 'safety_business_gateway_notification'");
    expect(sql).toContain('external_reference IS NOT NULL');
    expect(sql).toContain('evidence_document_id IS NOT NULL');
    expect(sql).toContain('consumer_personal_data_included = false');
  });

  test('indexes tenant, retention, reviewer, recorder and evidence queries', () => {
    for (const name of ['idx_gpsr_technical_files_tenant', 'idx_gpsr_technical_files_retention',
      'idx_gpsr_technical_file_reviews_reviewer', 'idx_gpsr_post_market_events_evidence',
      'idx_gpsr_post_market_events_recorded_by']) expect(sql).toContain(name);
  });
});
