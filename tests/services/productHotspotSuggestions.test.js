const { buildProductHotspotSuggestions } = require('../../src/services/chatService/productHotspotSuggestions');

describe('buildProductHotspotSuggestions (LOI-036)', () => {
  test('targets the real hotspots of a cotton tee on grid electricity', () => {
    const suggestions = buildProductHotspotSuggestions({
      perProduct: { materials: 1.4, production: 0.6, transport: 0.05, total: 2.05 },
      materials: [{ materialType: 'cotton', percentage: 100 }],
      energySources: [{ source: 'grid', percentage: 100 }],
      transportLegs: [{ mode: 'road' }]
    });
    const ids = suggestions.map((item) => item.id);
    expect(ids).toContain('material-low-impact-fibre');
    expect(ids).toContain('manufacturing-rooftop-solar');
    expect(ids).not.toContain('transport-load-optimisation');
    suggestions.forEach((item) => expect(item.potentialReduction).toBeGreaterThanOrEqual(0));
  });

  test('does not suggest recycled fibre again or transport cuts for negligible transport', () => {
    const suggestions = buildProductHotspotSuggestions({
      perProduct: { materials: 1.0, production: 0.5, transport: 0.001, total: 1.5 },
      materials: [{ materialType: 'recycled_polyester', percentage: 60 }, { materialType: 'cotton', percentage: 40 }],
      energySources: [{ source: 'solar', percentage: 40 }, { source: 'grid', percentage: 60 }]
    });
    const ids = suggestions.map((item) => item.id);
    expect(ids).not.toContain('material-low-impact-fibre');
    expect(ids.some((id) => id.startsWith('transport'))).toBe(false);
    expect(ids).not.toContain('manufacturing-rooftop-solar');
  });

  test('suggests moving air legs to sea', () => {
    const suggestions = buildProductHotspotSuggestions({
      perProduct: { materials: 1, production: 0.5, transport: 2, total: 3.5 },
      transportLegs: [{ mode: 'air' }]
    });
    expect(suggestions[0].id).toBe('transport-air-to-sea');
  });

  test('returns nothing without a carbon result', () => {
    expect(buildProductHotspotSuggestions({ perProduct: {} })).toEqual([]);
  });
});
