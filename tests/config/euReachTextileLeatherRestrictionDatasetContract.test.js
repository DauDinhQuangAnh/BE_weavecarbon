const dataset = require('../../src/data/regulatory/euReachTextileLeatherRestrictionDataset.json');

describe('R20 limited REACH textile/leather restriction dataset contract', () => {
  test('pins the legal snapshot and official source set', () => {
    expect(dataset).toMatchObject({
      datasetId: 'weavecarbon.eu-reach-textile-leather-restriction-routing',
      version: 'EU-REACH-TEXTILE-LEATHER-2026.09.14.1',
      coverageStatus: 'limited', checkedAt: '2026-09-14', reachConsolidatedAt: '2026-05-11'
    });
    expect(dataset.sources).toHaveLength(4);
    expect(dataset.sources.every((source) =>
      /^https:\/\/(eur-lex\.europa\.eu|(?:euon\.)?echa\.europa\.eu)\//.test(source.url)
    )).toBe(true);
  });

  test('contains unique, bounded entries 43, 46a and 47 with exact threshold semantics', () => {
    expect(dataset.restrictions.map((item) => item.entryNumber)).toEqual(['43', '46a', '47']);
    expect(new Set(dataset.restrictions.map((item) => item.ruleId)).size).toBe(3);
    expect(dataset.restrictions.map((item) => item.threshold)).toEqual([
      { operator: 'above', value: 30, unit: 'mg/kg' },
      { operator: 'greater_than_or_equal', value: 0.01, unit: 'percent_by_weight' },
      { operator: 'greater_than_or_equal', value: 3, unit: 'mg/kg_dry_leather' }
    ]);
    expect(dataset.restrictions.every((item) =>
      item.sourceId && item.scope && item.requiredScopeFacts.length && item.requiredEvidenceTypes.length
    )).toBe(true);
  });

  test('states that it cannot produce a complete REACH or conformity conclusion', () => {
    expect(dataset.explicitExclusions.join(' ')).toMatch(/complete REACH Annex XVII/i);
    expect(dataset.explicitExclusions.join(' ')).toMatch(/conformity decisions/i);
    expect(dataset.explicitExclusions.join(' ')).toMatch(/generic REACH certificate/i);
  });
});
