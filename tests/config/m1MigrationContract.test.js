const fs = require('fs');
const path = require('path');

const readMigration = (name) => fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', name),
  'utf8'
);

describe('M1 migration contract', () => {
  test('backfills snapshot ownership while preserving finalized-row immutability', () => {
    const sql = readMigration('014_m1_factor_registry_and_snapshot_tenant.sql');
    const dropPosition = sql.indexOf('DROP TRIGGER IF EXISTS trg_product_snapshot_immutable');
    const backfillPosition = sql.indexOf('UPDATE public.product_assessment_snapshots snapshots');
    const restorePosition = sql.indexOf('CREATE TRIGGER trg_product_snapshot_immutable');

    expect(dropPosition).toBeGreaterThan(-1);
    expect(backfillPosition).toBeGreaterThan(dropPosition);
    expect(restorePosition).toBeGreaterThan(backfillPosition);
    expect(sql).toContain('ALTER COLUMN company_id SET NOT NULL');
    expect(sql).toContain('FOREIGN KEY (product_id, company_id)');
    expect(sql).toContain('reject_factor_catalog_mutation');
  });

  test('creates only the six mapped hot-query indexes concurrently', () => {
    const sql = readMigration('015_m1_hot_query_indexes.sql');
    const indexes = [...sql.matchAll(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g)];
    expect(indexes).toHaveLength(6);
  });

  test('keeps the integration immutability fixture tenant-scoped', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'test-immutable-snapshots.js'),
      'utf8'
    );
    expect(script).toContain('product_id, company_id, version, payload');
    expect(script).toContain('WHERE product_id = $1 AND company_id = $2');
  });
});
