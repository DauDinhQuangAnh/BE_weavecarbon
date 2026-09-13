const dataset = require('../../src/data/regulatory/euWildlifeTradeSpeciesRoutingDataset.json');

describe('R20 limited EU wildlife-trade species dataset contract', () => {
  test('pins the post-CoP20 EU Annex and suspension source versions', () => {
    expect(dataset).toMatchObject({
      datasetId: 'weavecarbon.eu-wildlife-trade-species-routing',
      version: 'EU-WILDLIFE-TRADE-2026.09.14.1', coverageStatus: 'limited',
      effectiveFrom: '2026-06-29', checkedAt: '2026-09-14'
    });
    expect(dataset.sources).toHaveLength(3);
    expect(dataset.sources.every((source) =>
      /^https:\/\/eur-lex\.europa\.eu\//.test(source.url)
    )).toBe(true);
  });

  test('contains three unique exact species records with explicit EU/CITES listing bases', () => {
    expect(dataset.species.map((item) => item.scientificName)).toEqual([
      'Crocodylus siamensis', 'Python reticulatus', 'Varanus salvator'
    ]);
    expect(new Set(dataset.species.map((item) => item.scientificName.toLowerCase())).size).toBe(3);
    expect(dataset.species[0]).toMatchObject({
      citesAppendix: 'I', euAnnex: 'A', euListingBasis: 'explicit_species',
      commercialPurposeReviewRequired: true
    });
    expect(dataset.species.slice(1).every((item) =>
      item.citesAppendix === 'II' && item.euAnnex === 'B' && item.euListingBasis === 'higher_taxon'
    )).toBe(true);
    expect(dataset.allowedAnimalSourceCodes).toEqual(['W', 'R', 'D', 'C', 'F', 'I', 'O', 'U', 'X']);
  });

  test('excludes authority, suspension, quota and document-validity conclusions', () => {
    const exclusions = dataset.explicitExclusions.join(' ');
    expect(exclusions).toMatch(/Complete CITES Appendices/i);
    expect(exclusions).toMatch(/suspension, quota or reservation/i);
    expect(exclusions).toMatch(/Permit issuance, validity, authenticity/i);
    expect(exclusions).toMatch(/Vietnam export or re-export/i);
  });
});
