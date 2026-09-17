const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/050_g2_industry_pack_expansion.sql'), 'utf8');

describe('G2-12 industry-pack expansion migration', () => {
  test.each(['steel', 'cement', 'textile_apparel', 'aluminium', 'construction_materials', 'fertiliser_chemicals', 'mining_minerals'])(
    'permits %s snapshots', (packId) => expect(sql).toContain(`'${packId}'`)
  );

  test('keeps the existing append-only pilot table and explicit truth boundary', () => {
    expect(sql).toMatch(/ALTER TABLE public\.industry_pack_pilot_snapshots/i);
    expect(sql).toMatch(/software-pilot snapshots/i);
    expect(sql).toMatch(/sector-expert and real-facility acceptance/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
