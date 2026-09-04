#!/usr/bin/env node

require('dotenv').config();
const pool = require('../src/config/database');
const { FACTOR_REGISTRY_VERSION, getFactorRegistryMetadata } = require('../src/modules/carbon/core');

async function scalar(sql, params = []) {
  const result = await pool.query(sql, params);
  return Number(Object.values(result.rows[0] || {})[0] || 0);
}

async function main() {
  const metadata = getFactorRegistryMetadata();
  const [orphanedSnapshots, crossTenantSnapshots, factorCount] = await Promise.all([
    scalar(`SELECT COUNT(*) FROM product_assessment_snapshots WHERE company_id IS NULL`),
    scalar(`SELECT COUNT(*)
            FROM product_assessment_snapshots s
            JOIN products p ON p.id = s.product_id
            WHERE s.company_id <> p.company_id`),
    scalar(`SELECT COUNT(*) FROM emission_factors WHERE registry_version = $1`, [FACTOR_REGISTRY_VERSION])
  ]);

  const result = {
    factorRegistryVersion: FACTOR_REGISTRY_VERSION,
    expectedFactorCount: metadata.factorCount,
    factorCount,
    orphanedSnapshots,
    crossTenantSnapshots
  };
  console.log(JSON.stringify(result, null, 2));
  if (orphanedSnapshots !== 0 || crossTenantSnapshots !== 0 || factorCount !== metadata.factorCount) {
    throw new Error('M1 migration integrity verification failed.');
  }
}

main()
  .catch((error) => {
    console.error('[m1-integrity] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => pool.end().catch(() => {}));
