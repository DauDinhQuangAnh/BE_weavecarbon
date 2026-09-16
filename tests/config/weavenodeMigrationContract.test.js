const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/044_g2_weavenode_ingestion.sql'), 'utf8');

test('WeaveNode ledger is tenant-bound, immutable and replay-deduplicated', () => {
  for (const name of ['weavenode_devices', 'weavenode_device_events', 'weavenode_calibration_revisions', 'weavenode_packets', 'weavenode_packet_acceptances']) {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${name}`);
  }
  expect(sql).toContain('UNIQUE(device_id, sequence_number)');
  expect(sql).toContain('FOREIGN KEY (device_id, packet_id, company_id, sequence_number)');
  expect(sql).toContain('FOREIGN KEY (device_id, calibration_revision_id, company_id)');
  expect((sql.match(/BEFORE UPDATE OR DELETE/g) || []).length).toBe(5);
});
