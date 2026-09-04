const crypto = require('crypto');
const { FACTOR_REGISTRY_VERSION } = require('./core/factorRegistry');

const SNAPSHOT_SCHEMA_VERSION = 'carbon-calculation-snapshot-v1';

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      const item = value[key];
      if (item !== undefined) result[key] = canonicalize(item);
      return result;
    }, {});
};

const stableCanonicalJson = (value) => JSON.stringify(canonicalize(value));

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const buildCalculationMetadata = ({ input, result, calculatedAt = new Date() }) => {
  const timestamp = calculatedAt instanceof Date
    ? calculatedAt.toISOString()
    : new Date(calculatedAt).toISOString();
  const factors = Array.isArray(result?.factorSourceSummary)
    ? result.factorSourceSummary
    : [];
  const assumptions = Array.isArray(result?.assumptionsUsed)
    ? result.assumptionsUsed
    : [];

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion: result?.trace?.ruleEngineVersion || 'unknown-engine',
    methodologyVersion: result?.methodologyVersion || 'unknown-methodology',
    factorRegistryVersion: FACTOR_REGISTRY_VERSION,
    gwpBasis: result?.methodology?.gwpBasis || 'unknown-gwp-basis',
    calculatedAt: timestamp,
    canonicalInputHash: sha256(stableCanonicalJson(input)),
    factors: canonicalize(factors),
    assumptions: canonicalize(assumptions),
    legacy: false
  };
};

const buildFinalizedCalculationSnapshot = ({
  assessmentPayload = {},
  input,
  result,
  calculatedAt
}) => {
  const metadata = buildCalculationMetadata({ input, result, calculatedAt });
  return {
    payload: {
      ...assessmentPayload,
      carbonInput: canonicalize(input),
      carbonResults: canonicalize(result),
      calculationMetadata: metadata
    },
    metadata
  };
};

const insertFinalizedProductSnapshot = async (client, {
  productId,
  companyId,
  assessmentPayload,
  input,
  result,
  calculatedAt
}) => {
  const snapshot = buildFinalizedCalculationSnapshot({
    assessmentPayload,
    input,
    result,
    calculatedAt
  });
  const { metadata } = snapshot;
  const inserted = await client.query(
    `
      INSERT INTO product_assessment_snapshots (
        product_id,
        company_id,
        version,
        payload,
        engine_version,
        methodology_version,
        factor_registry_version,
        gwp_basis,
        calculated_at,
        canonical_input_hash,
        factor_snapshot,
        assumptions,
        is_legacy,
        finalized_at
      )
      SELECT
        $1,
        $2,
        COALESCE(MAX(version), 0) + 1,
        $3::jsonb,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11::jsonb,
        false,
        $8
      FROM product_assessment_snapshots
      WHERE product_id = $1 AND company_id = $2
      RETURNING
        id AS snapshot_id,
        version AS snapshot_version,
        calculated_at AS snapshot_calculated_at,
        engine_version AS snapshot_engine_version,
        methodology_version AS snapshot_methodology_version,
        factor_registry_version AS snapshot_factor_registry_version,
        gwp_basis AS snapshot_gwp_basis,
        canonical_input_hash AS snapshot_canonical_input_hash,
        is_legacy AS snapshot_is_legacy
    `,
    [
      productId,
      companyId,
      JSON.stringify(snapshot.payload),
      metadata.engineVersion,
      metadata.methodologyVersion,
      metadata.factorRegistryVersion,
      metadata.gwpBasis,
      metadata.calculatedAt,
      metadata.canonicalInputHash,
      JSON.stringify(metadata.factors),
      JSON.stringify(metadata.assumptions)
    ]
  );

  return { ...snapshot, row: inserted.rows[0] };
};

module.exports = {
  FACTOR_REGISTRY_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  buildCalculationMetadata,
  buildFinalizedCalculationSnapshot,
  canonicalize,
  insertFinalizedProductSnapshot,
  stableCanonicalJson
};
