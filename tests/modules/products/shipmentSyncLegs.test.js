const { normalizeShipmentLegs } = require('../../../src/modules/products/services/shipmentSync');

describe('normalizeShipmentLegs (LOI-028)', () => {
  test('multiplies the tonne-km factor by the cargo weight', () => {
    const legs = normalizeShipmentLegs(
      [
        { mode: 'road', distance_km: 20 },
        { mode: 'sea', distance_km: 18273 }
      ],
      {},
      {},
      0,
      9
    );
    // 20 km × 0.12226 × 0.009 t and 18 273 km × 0.01612 × 0.009 t
    expect(legs[0].co2e).toBeCloseTo(20 * 0.12226 * 0.009, 6);
    expect(legs[1].co2e).toBeCloseTo(18273 * 0.01612 * 0.009, 6);
  });

  test('distributes the calculated transport total when the cargo weight is unknown', () => {
    const legs = normalizeShipmentLegs(
      [
        { mode: 'road', distance_km: 100 },
        { mode: 'sea', distance_km: 300 }
      ],
      {},
      {},
      4,
      0
    );
    expect(legs[0].co2e + legs[1].co2e).toBeCloseTo(4, 6);
  });
});
