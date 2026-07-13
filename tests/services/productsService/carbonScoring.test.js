const {
    sumPercentage,
    hasAddressData,
    buildCarbonResultsWithConfidence,
    computeDataConfidenceScore
} = require('../../../src/services/productsService/carbonScoring');

describe('sumPercentage', () => {
    it('sums non-negative percentages, clamping negatives to 0', () => {
        expect(sumPercentage([{ percentage: 30 }, { percentage: 20 }])).toBe(50);
        expect(sumPercentage([{ percentage: -10 }, { percentage: 20 }])).toBe(20);
    });

    it('returns 0 for an empty list', () => {
        expect(sumPercentage([])).toBe(0);
    });
});

describe('hasAddressData', () => {
    it('returns true when any address field is populated', () => {
        expect(hasAddressData({ city: 'Hanoi' })).toBe(true);
        expect(hasAddressData({ lat: 21.0, lng: 105.8 })).toBe(true);
    });

    it('returns false for empty or invalid input', () => {
        expect(hasAddressData({})).toBe(false);
        expect(hasAddressData(null)).toBe(false);
        expect(hasAddressData({ streetNumber: '   ' })).toBe(false);
    });
});

describe('buildCarbonResultsWithConfidence', () => {
    it('merges normalized confidence fields into the carbon results', () => {
        const result = buildCarbonResultsWithConfidence({ total: 10 }, 92);
        expect(result).toEqual({
            total: 10,
            confidenceLevel: 'high',
            confidence_level: 'high',
            confidenceScore: 92,
            confidence_score: 92
        });
    });

    it('clamps out-of-range scores', () => {
        expect(buildCarbonResultsWithConfidence({}, 150).confidenceScore).toBe(100);
        expect(buildCarbonResultsWithConfidence({}, -20).confidenceScore).toBe(0);
    });
});

describe('computeDataConfidenceScore', () => {
    it('uses an explicitly provided confidence score when present', () => {
        expect(computeDataConfidenceScore({ carbonResults: { confidenceScore: 77 } })).toBe(77);
        expect(computeDataConfidenceScore({ confidence_score: 42 })).toBe(42);
    });

    it('clamps an explicitly provided score to 0-100', () => {
        expect(computeDataConfidenceScore({ carbonResults: { confidence_score: 150 } })).toBe(100);
    });

    it('returns a low baseline score for a nearly-empty payload', () => {
        const score = computeDataConfidenceScore({});
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThan(15);
    });

    it('scores higher for a fully specified product than a minimal one', () => {
        const minimal = computeDataConfidenceScore({});
        const complete = computeDataConfidenceScore({
            materials: [
                { materialType: 'cotton', source: 'domestic', percentage: 60 },
                { materialType: 'polyester', source: 'domestic', percentage: 40 }
            ],
            productionProcesses: ['knitting', 'dyeing'],
            manufacturingLocation: 'Hanoi',
            wasteRecovery: 'recycled',
            energySources: [{ source: 'grid', percentage: 100 }],
            transportLegs: [{ estimatedDistance: 500, mode: 'road' }],
            originAddress: { city: 'Hanoi', country: 'VN' },
            destinationAddress: { city: 'Berlin', country: 'DE' }
        });
        expect(complete).toBeGreaterThan(minimal);
    });

    it('applies a penalty when proxy data is used', () => {
        const withoutProxy = computeDataConfidenceScore({
            materials: [{ materialType: 'cotton', source: 'domestic', percentage: 100 }]
        });
        const withProxy = computeDataConfidenceScore({
            materials: [{ materialType: 'cotton', source: 'domestic', percentage: 100 }],
            carbonResults: { proxyUsed: true, proxyNotes: ['estimated grid mix', 'estimated distance'] }
        });
        expect(withProxy).toBeLessThan(withoutProxy);
    });

    it('never returns a value outside 0-100', () => {
        const score = computeDataConfidenceScore({
            materials: [
                { materialType: 'x', source: 'unknown', percentage: 50 },
                { materialType: 'y', source: 'unknown', percentage: 50 }
            ],
            carbonResults: { proxyUsed: true, proxyNotes: ['a', 'b', 'c', 'd', 'e'] }
        });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });
});
