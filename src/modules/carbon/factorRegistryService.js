const { FACTOR_REGISTRY_VERSION, getFactorRegistryMetadata } = require('./core/factorRegistry');
const { factorRegistryRepository } = require('./factorRegistryRepository');

function toProvenance(row) {
  if (!row) return null;
  return {
    registryVersion: row.registry_version,
    factorId: row.factor_id,
    factorVersionId: row.factor_version_id,
    label: row.label,
    value: Number(row.value),
    unit: row.unit,
    source: {
      name: row.source_name,
      url: row.source_url,
      year: row.source_year == null ? null : Number(row.source_year)
    },
    geography: row.geography,
    boundary: row.boundary,
    validity: {
      from: row.valid_from || null,
      to: row.valid_to || null
    },
    quality: {
      grade: row.quality,
      class: row.factor_class,
      uncertaintyCv: Number(row.uncertainty_cv),
      isProxy: Boolean(row.is_proxy),
      scores: row.metadata?.qualityScores || null
    },
    gwpBasis: row.gwp_basis
  };
}

function createFactorRegistryService({ repository = factorRegistryRepository } = {}) {
  return {
    async listRegistries() {
      return repository.listRegistries();
    },

    async listFactors(filters = {}) {
      const registryVersion = filters.registryVersion || FACTOR_REGISTRY_VERSION;
      const rows = await repository.listFactors({ ...filters, registryVersion });
      return {
        registry: registryVersion === FACTOR_REGISTRY_VERSION
          ? getFactorRegistryMetadata()
          : { version: registryVersion },
        factors: rows.map(toProvenance)
      };
    },

    async getFactor(factorId, registryVersion = FACTOR_REGISTRY_VERSION) {
      return toProvenance(await repository.getFactor(factorId, registryVersion));
    }
  };
}

module.exports = {
  createFactorRegistryService,
  factorRegistryService: createFactorRegistryService(),
  toProvenance
};
