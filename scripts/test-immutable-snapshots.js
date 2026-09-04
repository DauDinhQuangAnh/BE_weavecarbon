#!/usr/bin/env node

require('dotenv').config();

const pool = require('../src/config/database');

const COMPANY_ID = '00000000-0000-4000-8000-000000000051';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000052';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function expectImmutable(client, sql, params, label) {
  await client.query(`SAVEPOINT ${label}`);
  try {
    await client.query(sql, params);
    throw new Error(`${label} unexpectedly allowed a finalized snapshot update`);
  } catch (error) {
    if (error.code !== '55000') throw error;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
    await client.query(`RELEASE SAVEPOINT ${label}`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const legacy = await client.query(
      `SELECT * FROM product_assessment_snapshots
       WHERE product_id = $1 AND version = 1`,
      [PRODUCT_ID]
    );
    assert(legacy.rows.length === 1, 'Legacy fixture was not preserved by migration');
    assert(legacy.rows[0].is_legacy === true, 'Legacy snapshot is not explicitly labeled');
    assert(
      String(legacy.rows[0].engine_version).startsWith('legacy-'),
      'Legacy engine version marker is missing'
    );
    assert(
      String(legacy.rows[0].canonical_input_hash).startsWith('legacy:'),
      'Legacy canonical input marker is missing'
    );

    await expectImmutable(
      client,
      'UPDATE product_assessment_snapshots SET payload = $2::jsonb WHERE id = $1',
      [legacy.rows[0].id, JSON.stringify({ tampered: true })],
      'product_snapshot_immutable'
    );

    const currentTimestamp = new Date().toISOString();
    const inserted = await client.query(
      `INSERT INTO product_assessment_snapshots (
         product_id, company_id, version, payload,
         engine_version, methodology_version, factor_registry_version, gwp_basis,
         calculated_at, canonical_input_hash, factor_snapshot, assumptions,
         is_legacy, finalized_at
       ) VALUES (
         $1, $2, 2, $3::jsonb,
         'engine-v1', 'method-v1', 'factors-v1:test', 'IPCC_AR5_100y',
         $4, $5, $6::jsonb, $7::jsonb, false, $4
       ) RETURNING id, version`,
      [
        PRODUCT_ID,
        COMPANY_ID,
        JSON.stringify({ calculationMetadata: { schemaVersion: 'carbon-calculation-snapshot-v1' } }),
        currentTimestamp,
        'a'.repeat(64),
        JSON.stringify([{ factorId: 'factor-1', value: 1.25, unit: 'kgCO2e' }]),
        JSON.stringify(['test assumption'])
      ]
    );
    assert(inserted.rows[0].version === 2, 'Recalculation did not create version 2');

    const latest = await client.query(
      `SELECT id, version FROM latest_product_assessment_snapshots
       WHERE product_id = $1 AND company_id = $2`,
      [PRODUCT_ID, COMPANY_ID]
    );
    assert(latest.rows[0]?.id === inserted.rows[0].id, 'Latest snapshot view did not select version 2');

    const calculation = await client.query(
      `INSERT INTO carbon_calculations (
         company_id, product_id, calculation_type, total_co2e,
         engine_version, methodology_version, factor_registry_version, gwp_basis,
         calculated_at, canonical_input_hash, input_snapshot, factor_snapshot,
         assumptions, is_legacy, finalized_at
       ) VALUES (
         $1, $2, 'product', 1.25,
         'engine-v1', 'method-v1', 'factors-v1:test', 'IPCC_AR5_100y',
         $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, false, $3
       ) RETURNING id`,
      [
        COMPANY_ID,
        PRODUCT_ID,
        currentTimestamp,
        'b'.repeat(64),
        JSON.stringify({ quantity: 1 }),
        JSON.stringify([{ factorId: 'factor-1', value: 1.25 }]),
        JSON.stringify(['test assumption'])
      ]
    );
    await expectImmutable(
      client,
      'UPDATE carbon_calculations SET total_co2e = 999 WHERE id = $1',
      [calculation.rows[0].id],
      'carbon_calculation_immutable'
    );

    await client.query('ROLLBACK');
    await pool.query('DELETE FROM companies WHERE id = $1', [COMPANY_ID]);
    console.log('WP-CARB5 migration, legacy backfill, immutability and versioning OK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
