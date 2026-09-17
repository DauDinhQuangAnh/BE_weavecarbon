const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/048_g2_weavenode_operations.sql'), 'utf8');

test('WeaveNode operations add dual time, hierarchy, health and signed update ledgers', () => {
  for (const item of ['source_recorded_at', 'gateway_received_at', 'source_gateway_drift_seconds',
    'industrial_meter_hierarchy_revisions', 'industrial_meter_reconciliation_snapshots',
    'weavenode_health_reports', 'weavenode_release_signing_keys', 'weavenode_update_revisions']) {
    expect(sql).toContain(item);
  }
  expect(sql).toContain("rollout_stage IN ('staged', 'canary', 'production', 'rollback')");
  expect(sql).toContain("sensor_status IN ('ok', 'warning', 'fault')");
  expect((sql.match(/BEFORE UPDATE OR DELETE/g) || []).length).toBe(6);
});
