const {
  createFactorRegistryRepository,
  serializeCurrentFactors
} = require('../../../src/modules/carbon/factorRegistryRepository');
const { getFactorRegistryMetadata } = require('../../../src/modules/carbon/core/factorRegistry');

describe('factor registry repository', () => {
  test('serializes every current factor with immutable version identity', () => {
    const rows = serializeCurrentFactors();
    expect(rows).toHaveLength(getFactorRegistryMetadata().factorCount);
    expect(new Set(rows.map((row) => row.factor_version_id)).size).toBe(rows.length);
    expect(rows.every((row) => row.registry_version === getFactorRegistryMetadata().version)).toBe(true);
  });

  test('refuses a persisted registry whose hash does not match the code registry', async () => {
    const database = { query: jest.fn() };
    const queryable = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ content_hash: 'tampered', factor_count: 1 }] })
    };
    const repository = createFactorRegistryRepository({ database });

    await expect(repository.syncCurrentRegistry(queryable))
      .rejects.toThrow('identity mismatch');
    expect(queryable.query).toHaveBeenCalledTimes(2);
  });
});
