const { createAppError } = require('../shared/errors');

const AUTHORITY_SOURCE = 'product_assessment_snapshot';

const asObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const asNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildCarbonAuthorityReference = (row = {}) => {
  const calculationId = row.snapshot_id || row.calculation_id;
  if (!calculationId) return null;

  return {
    authoritative: true,
    source: AUTHORITY_SOURCE,
    calculationId,
    calculationVersion: Math.max(1, Math.trunc(asNumber(
      row.snapshot_version ?? row.calculation_version ?? row.version,
      1
    ))),
    calculatedAt:
      row.snapshot_calculated_at || row.calculated_at ||
      row.snapshot_updated_at || row.updated_at || row.created_at || null,
    engineVersion: row.snapshot_engine_version || row.engine_version || 'legacy-unversioned',
    methodologyVersion:
      row.snapshot_methodology_version || row.methodology_version || 'legacy-unversioned',
    factorRegistryVersion:
      row.snapshot_factor_registry_version || row.factor_registry_version ||
      'legacy-unversioned',
    gwpBasis: row.snapshot_gwp_basis || row.gwp_basis || 'legacy-unversioned',
    canonicalInputHash:
      row.snapshot_canonical_input_hash || row.canonical_input_hash ||
      `legacy:${calculationId}`,
    legacy: Boolean(row.snapshot_is_legacy ?? row.is_legacy ?? true)
  };
};

const buildAuthoritativeCarbonResult = (row = {}) => {
  const snapshot = asObject(row.payload);
  const snapshotResult = asObject(snapshot.carbonResults || snapshot.carbon_results);
  const snapshotPerProduct = asObject(
    snapshotResult.perProduct || snapshotResult.per_product
  );

  return {
    ...snapshotResult,
    perProduct: {
      ...snapshotPerProduct,
      materials: asNumber(row.materials_co2e, asNumber(snapshotPerProduct.materials)),
      production: asNumber(row.production_co2e, asNumber(snapshotPerProduct.production)),
      energy: asNumber(snapshotPerProduct.energy),
      transport: asNumber(row.transport_co2e, asNumber(snapshotPerProduct.transport)),
      packaging: asNumber(row.packaging_co2e, asNumber(snapshotPerProduct.packaging)),
      total: asNumber(row.total_co2e, asNumber(snapshotPerProduct.total))
    }
  };
};

const loadAuthoritativeProductCarbon = async (database, productId, companyId) => {
  const result = await database.query(
    `
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p.weight_kg,
        p.total_co2e,
        p.materials_co2e,
        p.production_co2e,
        p.transport_co2e,
        p.packaging_co2e,
        s.id AS snapshot_id,
        s.version AS snapshot_version,
        s.payload,
        s.calculated_at AS snapshot_calculated_at,
        s.engine_version AS snapshot_engine_version,
        s.methodology_version AS snapshot_methodology_version,
        s.factor_registry_version AS snapshot_factor_registry_version,
        s.gwp_basis AS snapshot_gwp_basis,
        s.canonical_input_hash AS snapshot_canonical_input_hash,
        s.is_legacy AS snapshot_is_legacy
      FROM products p
      INNER JOIN latest_product_assessment_snapshots s ON s.product_id = p.id
      WHERE p.id = $1 AND p.company_id = $2
      LIMIT 1
    `,
    [productId, companyId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    product: row,
    snapshot: asObject(row.payload),
    carbonResults: buildAuthoritativeCarbonResult(row),
    carbonAuthority: buildCarbonAuthorityReference(row)
  };
};

const requireAuthoritativeProductCarbon = async (database, productId, companyId) => {
  const record = await loadAuthoritativeProductCarbon(database, productId, companyId);
  if (record?.carbonAuthority) return record;

  throw createAppError('A server-authoritative product calculation is required.', {
    statusCode: 409,
    code: 'AUTHORITATIVE_CARBON_REQUIRED'
  });
};

module.exports = {
  AUTHORITY_SOURCE,
  buildAuthoritativeCarbonResult,
  buildCarbonAuthorityReference,
  loadAuthoritativeProductCarbon,
  requireAuthoritativeProductCarbon
};
