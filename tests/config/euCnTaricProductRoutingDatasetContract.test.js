const dataset = require('../../src/data/regulatory/euCnTaricProductRoutingDataset.json');

describe('R20 EU CN/TARIC routing dataset contract', () => {
  test('pins the 2026 CN window and a dated TARIC consultation', () => {
    expect(dataset).toMatchObject({
      datasetId: 'weavecarbon.eu-cn-taric-product-routing',
      version: 'EU-CN-TARIC-2026.09.14.1', coverageStatus: 'limited',
      cnValidFrom: '2026-01-01', cnValidTo: '2026-12-31',
      taricConsultedAt: '2026-09-14', taricOriginContext: 'VN'
    });
    expect(dataset.sources.map((source) => source.id)).toEqual([
      'EU-2025-1926', 'EU-TARIC-2026-09-14'
    ]);
    expect(dataset.taricConsultationBaseUrl).toMatch(/^https:\/\/ec\.europa\.eu\//);
  });

  test('contains unique exact CN and TARIC leaf codes with explicit legal routes', () => {
    const cnCodes = dataset.entries.map((entry) => entry.cnCode);
    const taricCodes = dataset.entries.flatMap((entry) => entry.taricLeaves.map((leaf) => leaf.code));

    expect(new Set(cnCodes).size).toBe(cnCodes.length);
    expect(new Set(taricCodes).size).toBe(taricCodes.length);
    expect(cnCodes.every((value) => /^\d{8}$/.test(value))).toBe(true);
    expect(taricCodes.every((value) => /^\d{10}$/.test(value))).toBe(true);
    expect(dataset.entries.every((entry) =>
      entry.taricLeaves.every((leaf) => leaf.code.startsWith(entry.cnCode))
    )).toBe(true);
    expect(dataset.entries.every((entry) => entry.legalRouteCodes.length > 0)).toBe(true);
  });

  test('distinguishes the batik and other TARIC leaves under cotton shirts', () => {
    const entry = dataset.entries.find((item) => item.cnCode === '62052000');
    expect(entry.taricLeaves).toEqual([
      { code: '6205200010', description: 'Hand-printed by the batik method' },
      { code: '6205200090', description: 'Other' }
    ]);
    expect(dataset.excludedConclusions).toContain('binding tariff information');
  });
});
