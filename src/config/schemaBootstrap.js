const pool = require('./database');
const { setSchemaCapabilities } = require('./schemaCapabilities');

const REQUIRED_TABLES = [
  'companies',
  'products',
  'shipments',
  'reports',
  'subscription_cycles',
  'subscription_payment_sessions',
  'compliance_documents',
  'product_compliance_documents'
];

const REQUIRED_COLUMNS = [
  ['companies', 'domestic_market'],
  ['shipments', 'pending_until'],
  ['shipments', 'estimated_arrival_at'],
  ['shipments', 'actual_arrival_at'],
  ['shipments', 'simulation_enabled'],
  ['subscription_cycles', 'trial_started_at'],
  ['subscription_cycles', 'trial_ends_at'],
  ['subscription_cycles', 'standard_started_at'],
  ['subscription_cycles', 'standard_expires_at'],
  ['subscription_cycles', 'standard_sku_limit']
];

const REQUIRED_PRICING_PLAN_VALUES = [
  'trial',
  'standard',
  'standard_20',
  'standard_35',
  'standard_50',
  'export'
];

let bootstrapPromise = null;

async function collectSchemaFacts(client) {
  const tablesResult = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [Array.from(new Set([
      ...REQUIRED_TABLES,
      'market_readiness',
      'export_markets',
      'carbon_targets'
    ]))]
  );

  const columnsResult = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [Array.from(new Set(REQUIRED_COLUMNS.map(([tableName]) => tableName)))]
  );

  const enumResult = await client.query(
    `
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'pricing_plan'
    `
  );

  return {
    tables: new Set(tablesResult.rows.map((row) => row.table_name)),
    columns: new Set(columnsResult.rows.map((row) => `${row.table_name}.${row.column_name}`)),
    pricingPlanValues: new Set(enumResult.rows.map((row) => String(row.label || '').trim()))
  };
}

function buildCapabilities(facts) {
  return {
    hasMarketReadiness: facts.tables.has('market_readiness'),
    hasExportMarkets: facts.tables.has('export_markets'),
    hasCarbonTargets: facts.tables.has('carbon_targets'),
    hasProductComplianceDocuments: facts.tables.has('product_compliance_documents'),
    hasCompaniesDomesticMarketColumn: facts.columns.has('companies.domestic_market'),
    hasShipmentSimulationColumns: [
      'shipments.pending_until',
      'shipments.estimated_arrival_at',
      'shipments.actual_arrival_at',
      'shipments.simulation_enabled'
    ].every((key) => facts.columns.has(key)),
    hasSubscriptionSchema:
      facts.tables.has('subscription_cycles') &&
      facts.tables.has('subscription_payment_sessions') &&
      REQUIRED_PRICING_PLAN_VALUES.every((value) => facts.pricingPlanValues.has(value))
  };
}

function assertRequiredSchema(facts, capabilities) {
  const missingTables = REQUIRED_TABLES.filter((tableName) => !facts.tables.has(tableName));
  const missingColumns = REQUIRED_COLUMNS
    .map(([tableName, columnName]) => `${tableName}.${columnName}`)
    .filter((columnKey) => !facts.columns.has(columnKey));
  const missingPricingPlanValues = REQUIRED_PRICING_PLAN_VALUES
    .filter((value) => !facts.pricingPlanValues.has(value));

  if (
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    missingPricingPlanValues.length === 0 &&
    capabilities.hasShipmentSimulationColumns &&
    capabilities.hasSubscriptionSchema &&
    capabilities.hasCompaniesDomesticMarketColumn &&
    capabilities.hasProductComplianceDocuments
  ) {
    return;
  }

  const fragments = [];

  if (missingTables.length > 0) {
    fragments.push(`missing tables: ${missingTables.join(', ')}`);
  }

  if (missingColumns.length > 0) {
    fragments.push(`missing columns: ${missingColumns.join(', ')}`);
  }

  if (missingPricingPlanValues.length > 0) {
    fragments.push(`missing pricing_plan values: ${missingPricingPlanValues.join(', ')}`);
  }

  if (!capabilities.hasShipmentSimulationColumns) {
    fragments.push('shipment simulation columns are incomplete');
  }

  if (!capabilities.hasSubscriptionSchema) {
    fragments.push('subscription schema is incomplete');
  }

  if (!capabilities.hasCompaniesDomesticMarketColumn) {
    fragments.push('companies.domestic_market is missing');
  }

  if (!capabilities.hasProductComplianceDocuments) {
    fragments.push('product_compliance_documents table is missing');
  }

  throw new Error(
    `Database schema is not ready (${fragments.join('; ')}). Run "npm run migrate" before starting the API.`
  );
}

async function bootstrapSchemaCapabilities() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const client = await pool.connect();
      try {
        const facts = await collectSchemaFacts(client);
        const capabilities = buildCapabilities(facts);
        assertRequiredSchema(facts, capabilities);
        setSchemaCapabilities(capabilities);
        return capabilities;
      } finally {
        client.release();
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
}

module.exports = {
  bootstrapSchemaCapabilities
};
