const steel = require('../fixtures/industryPacks/steel.json');
const cement = require('../fixtures/industryPacks/cement.json');
const { PACKS, validate, calculate } = require('../../src/services/industryPackControls');
const factors = (fixture) => fixture.activityLines.map((line, index) => ({ id: line.factorProposalId, factor_id: `PILOT-${index}`, factor_value: [2, 3, 4][index], unit: `kgCO2e/${line.activityUnit}`, payload_sha256: 'a'.repeat(64), latest_review_decision: 'approved_for_release_candidate', boundary: 'Non-overlapping process segment', is_proxy: false }));
describe('G2-05 industry-pack pilot controls', () => {
  test.each([['steel', steel, 1550, 15.5], ['cement', cement, 2625, 13.125]])('%s fixture is deterministic and marked for specialist review', (id, fixture, kg, intensity) => {
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
});
