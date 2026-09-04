const pool = require('../shared/database');
const { withTransaction } = require('../shared/transaction');
const {
  FACTOR_REGISTRY_VERSION,
  getFactorRegistryMetadata,
  listFactorProvenance
} = require('./core/factorRegistry');

const FACTOR_COLUMNS = `
  registry_version,
  factor_id,
  factor_version_id,
  label,
  value,
  unit,
  source_name,
  source_url,
  source_year,
  geography,
  boundary,
  valid_from,
  valid_to,
  quality,
  factor_class,
  uncertainty_cv,
  is_proxy,
  gwp_basis,
  metadata
`;

function serializeCurrentFactors() {
  return listFactorProvenance().map((factor) => ({
    registry_version: factor.registryVersion,
    factor_id: factor.factorId,
    factor_version_id: factor.factorVersionId,
    label: factor.label,
    value: factor.value,
    unit: factor.unit,
    source_name: factor.source.name,
    source_url: factor.source.url,
    source_year: factor.source.year,
    geography: factor.geography,
    boundary: factor.boundary,
    valid_from: factor.validity.from,
    valid_to: factor.validity.to,
    quality: factor.quality.grade,
    factor_class: factor.quality.class,
    uncertainty_cv: factor.quality.uncertaintyCv,
    is_proxy: factor.quality.isProxy,
    gwp_basis: factor.gwpBasis,
    metadata: {
      qualityScores: factor.quality.scores
    }
  }));
}

function createFactorRegistryRepository({ database = pool } = {}) {
  const syncRegistry = async (queryable) => {
    const metadata = getFactorRegistryMetadata();
    await queryable.query(
      `INSERT INTO emission_factor_registries (
         registry_version, registry_id, release, schema_version, content_hash,
         factor_count, gwp_bases, status, published_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'published',NOW())
       ON CONFLICT (registry_version) DO NOTHING`,
      [
        metadata.version,
        metadata.id,
        metadata.release,
        metadata.schemaVersion,
        metadata.contentHash,
        metadata.factorCount,
        JSON.stringify(metadata.gwpBases)
      ]
    );

    const existing = await queryable.query(
      `SELECT content_hash, factor_count
       FROM emission_factor_registries
       WHERE registry_version = $1`,
      [metadata.version]
    );
    const row = existing.rows[0];
    if (!row || row.content_hash !== metadata.contentHash || Number(row.factor_count) !== metadata.factorCount) {
      throw new Error(`Emission factor registry identity mismatch for ${metadata.version}.`);
    }

    const serialized = serializeCurrentFactors();
    await queryable.query(
      `INSERT INTO emission_factors (${FACTOR_COLUMNS})
       SELECT
         x.registry_version, x.factor_id, x.factor_version_id, x.label,
         x.value, x.unit, x.source_name, x.source_url, x.source_year,
         x.geography, x.boundary, x.valid_from, x.valid_to, x.quality,
         x.factor_class, x.uncertainty_cv, x.is_proxy, x.gwp_basis, x.metadata
       FROM jsonb_to_recordset($1::jsonb) AS x(
         registry_version text, factor_id text, factor_version_id text, label text,
         value numeric, unit text, source_name text, source_url text, source_year integer,
         geography text, boundary text, valid_from date, valid_to date, quality text,
         factor_class text, uncertainty_cv numeric, is_proxy boolean, gwp_basis text, metadata jsonb
       )
       ON CONFLICT (factor_version_id) DO NOTHING`,
      [JSON.stringify(serialized)]
    );

    const count = await queryable.query(
      'SELECT COUNT(*)::int AS count FROM emission_factors WHERE registry_version = $1',
      [metadata.version]
    );
    if (Number(count.rows[0]?.count) !== metadata.factorCount) {
      throw new Error(`Emission factor registry ${metadata.version} is incomplete.`);
    }
    return metadata;
  };

  return {
    async syncCurrentRegistry(queryable = database) {
      return typeof queryable.connect === 'function'
        ? withTransaction(queryable, syncRegistry)
        : syncRegistry(queryable);
    },

    async listRegistries() {
      const result = await database.query(
        `SELECT registry_version, registry_id, release, schema_version, content_hash,
                factor_count, gwp_bases, status, published_at, created_at
         FROM emission_factor_registries
         ORDER BY published_at DESC, registry_version DESC`
      );
      return result.rows;
    },

    async listFactors({ registryVersion = FACTOR_REGISTRY_VERSION, unit, geography, factorClass, isProxy } = {}) {
      const conditions = ['registry_version = $1'];
      const params = [registryVersion];
      const add = (sql, value) => {
        params.push(value);
        conditions.push(`${sql} $${params.length}`);
      };
      if (unit) add('unit =', unit);
      if (geography) add('geography =', geography);
      if (factorClass) add('factor_class =', factorClass);
      if (typeof isProxy === 'boolean') add('is_proxy =', isProxy);

      const result = await database.query(
        `SELECT ${FACTOR_COLUMNS}
         FROM emission_factors
         WHERE ${conditions.join(' AND ')}
         ORDER BY factor_id ASC`,
        params
      );
      return result.rows;
    },

    async getFactor(factorId, registryVersion = FACTOR_REGISTRY_VERSION) {
      const result = await database.query(
        `SELECT ${FACTOR_COLUMNS}
         FROM emission_factors
         WHERE registry_version = $1
           AND (factor_id = $2 OR factor_version_id = $2)
         LIMIT 1`,
        [registryVersion, factorId]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = {
  FACTOR_COLUMNS,
  createFactorRegistryRepository,
  factorRegistryRepository: createFactorRegistryRepository(),
  serializeCurrentFactors
};
