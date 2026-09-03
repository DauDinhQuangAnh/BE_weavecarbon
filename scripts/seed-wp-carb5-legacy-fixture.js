#!/usr/bin/env node

require('dotenv').config();

const pool = require('../src/config/database');

const COMPANY_ID = '00000000-0000-4000-8000-000000000051';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000052';

async function main() {
  if (process.env.ALLOW_MIGRATION_TEST_FIXTURE !== '1') {
    throw new Error('Refusing to seed a migration fixture outside the explicit CI test step.');
  }

  await pool.query(
    `INSERT INTO companies (id, name, business_type)
     VALUES ($1, 'WP-CARB5 migration fixture', 'factory')
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID]
  );
  await pool.query(
    `INSERT INTO products (id, company_id, sku, name)
     VALUES ($1, $2, 'WP-CARB5-LEGACY', 'Legacy calculation fixture')
     ON CONFLICT (id) DO NOTHING`,
    [PRODUCT_ID, COMPANY_ID]
  );
  await pool.query(
    `INSERT INTO product_assessment_snapshots (product_id, version, payload)
     VALUES ($1, 1, $2::jsonb)
     ON CONFLICT (product_id) DO NOTHING`,
    [PRODUCT_ID, JSON.stringify({
      carbonInput: { quantity: 1 },
      carbonResults: { perProduct: { total: 1.25 } }
    })]
  );
}

main()
  .then(() => console.log('WP-CARB5 legacy fixture seeded'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
