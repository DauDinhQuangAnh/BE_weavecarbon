const dataset = require('../../src/data/regulatory/euPackagingApplicabilityDataset.json');

describe('R20 EU packaging applicability dataset contract', () => {
  test('is versioned, source-linked and explicitly limited', () => {
    expect(dataset.datasetId).toBe('weavecarbon.eu-ppwr-applicability');
    expect(dataset.version).toMatch(/^EU-PPWR-\d{4}\.\d{2}\.\d+$/);
    expect(dataset.appliesFrom).toBe('2026-08-12');
    expect(dataset.traceabilityArticle).toBe('22');
    expect(dataset.coverageStatus).toBe('limited');
    expect(dataset.sources.map((source) => source.id)).toEqual(['EU-2025-40', 'EC-C-2026-3702']);
    expect(dataset.sources.every((source) => source.url.startsWith('https://eur-lex.europa.eu/'))).toBe(true);
  });

  test('records retention routing and excludes unsafe conclusions', () => {
    expect(dataset.traceabilityRetentionYears).toEqual({ singleUse: 5, reusable: 10 });
    expect(dataset.excludedConclusions).toEqual(expect.arrayContaining([
      'packaging conformity', 'Member-State registration, fees or reporting'
    ]));
  });
});
