const {
  createFactorRegistryService,
  toProvenance
} = require('../../../src/modules/carbon/factorRegistryService');
const { FACTOR_REGISTRY_VERSION } = require('../../../src/modules/carbon/core/factorRegistry');

describe('factor registry service', () => {
  test('applies the pinned registry version and maps database provenance', async () => {
    const repository = {
      listFactors: jest.fn().mockResolvedValue([{
        registry_version: FACTOR_REGISTRY_VERSION,
        factor_id: 'factor-a',
        factor_version_id: 'factor-a:v1',
        label: 'Factor A',
        value: '1.25',
        unit: 'kgCO2e/kg',
        source_name: 'Source',
        source_url: 'https://example.test/source',
        source_year: 2025,
        geography: 'GLOBAL',
        boundary: 'cradle_to_gate',
        valid_from: '2025-01-01',
        valid_to: null,
        quality: 'B',
        factor_class: 'secondary',
        uncertainty_cv: '0.2',
        is_proxy: false,
        gwp_basis: 'IPCC_AR5_100y',
        metadata: { qualityScores: { temporal: 4 } }
      }])
    };
    const service = createFactorRegistryService({ repository });

    const result = await service.listFactors({ unit: 'kgCO2e/kg' });

    expect(repository.listFactors).toHaveBeenCalledWith({
      unit: 'kgCO2e/kg',
      registryVersion: FACTOR_REGISTRY_VERSION
    });
    expect(result.factors[0]).toMatchObject({
      factorId: 'factor-a',
      value: 1.25,
      source: { year: 2025 },
      quality: { uncertaintyCv: 0.2, isProxy: false }
    });
  });

  test('maps null as null', () => {
    expect(toProvenance(null)).toBeNull();
  });
});
