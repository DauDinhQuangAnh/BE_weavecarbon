const steel = require('../fixtures/industryPacks/steel.json');
const cement = require('../fixtures/industryPacks/cement.json');
const textile = require('../fixtures/industryPacks/textile_apparel.json');
const aluminium = require('../fixtures/industryPacks/aluminium.json');
const construction = require('../fixtures/industryPacks/construction_materials.json');
const fertiliser = require('../fixtures/industryPacks/fertiliser_chemicals.json');
const mining = require('../fixtures/industryPacks/mining_minerals.json');
const { PACKS, validate, calculate } = require('../../src/services/industryPackControls');
const factors = (fixture) => fixture.activityLines.map((line, index) => ({ id: line.factorProposalId, factor_id: `PILOT-${index}`, factor_value: [2, 3, 4, 5][index], unit: `kgCO2e/${line.activityUnit}`, payload_sha256: 'a'.repeat(64), latest_review_decision: 'approved_for_release_candidate', boundary: 'Non-overlapping process segment', is_proxy: false }));
describe('G2-05 industry-pack pilot controls', () => {
  test.each([
    ['steel', steel, 1550, 15.5], ['cement', cement, 2625, 13.125],
    ['textile_apparel', textile, 1550, 15.5], ['aluminium', aluminium, 2260, 22.6],
    ['construction_materials', construction, 2625, 13.125], ['fertiliser_chemicals', fertiliser, 2950, 29.5],
    ['mining_minerals', mining, 2825, 14.125]
  ])('%s fixture is deterministic and marked for specialist review', (id, fixture, kg, intensity) => {
    const checked = validate(fixture); expect(checked.errors).toEqual([]); expect(checked.pack.id).toBe(id);
    const result = calculate(checked.value, factors(fixture)); expect(result.status).toBe('specialist_review_required');
    expect(result.totals).toMatchObject({ grossKgCo2e: kg, intensityKgCo2ePerTonne: intensity });
    expect(PACKS[id].approvalStatus).toBe('expert_review_required');
  });
  test('rejects unsupported co-product allocation and ungoverned factors', () => {
    expect(validate({ ...steel, allocation: { method: 'economic', share: 0.7 } }).errors.join(' ')).toMatch(/single-product/);
    const result = calculate(validate(steel).value, factors(steel).map((factor) => ({ ...factor, latest_review_decision: null })));
    expect(result.status).toBe('needs_information'); expect(result.totals).toBeNull();
  });
  test('requires sector-specific context and activity categories', () => {
    expect(validate({ ...aluminium, sectorContext: { ...aluminium.sectorContext, recycledContentPercent: 120 } }).errors).toContain('sectorContext.recycledContentPercent must be 0–100.');
    expect(validate({ ...textile, sectorContext: { ...textile.sectorContext, materialOrBomReference: '' } }).errors.join(' ')).toMatch(/materialOrBomReference/);
    expect(validate({ ...textile, sectorContext: { ...textile.sectorContext, ungovernedField: 'value' } }).errors.join(' ')).toMatch(/Unsupported sectorContext fields/);
    expect(validate({ ...mining, activityLines: mining.activityLines.filter((line) => line.category !== 'transport') }).errors.join(' ')).toMatch(/transport/);
  });
});
