const {
    dbToFeStatus,
    feToDbStatus,
    getConfidenceLevel,
    clampConfidenceScore,
    buildDomesticComplianceWarning
} = require('../../../src/services/productsService/mappers');

describe('dbToFeStatus / feToDbStatus', () => {
    it('maps DB "active" to FE "published" and back', () => {
        expect(dbToFeStatus('active')).toBe('published');
        expect(feToDbStatus('published')).toBe('active');
    });

    it('passes through draft and archived unchanged in both directions', () => {
        expect(dbToFeStatus('draft')).toBe('draft');
        expect(dbToFeStatus('archived')).toBe('archived');
        expect(feToDbStatus('draft')).toBe('draft');
        expect(feToDbStatus('archived')).toBe('archived');
    });
});

describe('getConfidenceLevel', () => {
    it('classifies scores into high/medium/low bands', () => {
        expect(getConfidenceLevel(85)).toBe('high');
        expect(getConfidenceLevel(90)).toBe('high');
        expect(getConfidenceLevel(65)).toBe('medium');
        expect(getConfidenceLevel(84)).toBe('medium');
        expect(getConfidenceLevel(64)).toBe('low');
        expect(getConfidenceLevel(0)).toBe('low');
    });
});

describe('clampConfidenceScore', () => {
    it('clamps values to the 0-100 range', () => {
        expect(clampConfidenceScore(150)).toBe(100);
        expect(clampConfidenceScore(-10)).toBe(0);
        expect(clampConfidenceScore(42.5)).toBe(42.5);
    });

    it('treats non-numeric input as 0', () => {
        expect(clampConfidenceScore('not a number')).toBe(0);
        expect(clampConfidenceScore(undefined)).toBe(0);
    });
});

describe('buildDomesticComplianceWarning', () => {
    it('builds a warning payload from a validation result', () => {
        const warning = buildDomesticComplianceWarning({
            marketCode: 'VN',
            requiredDocuments: ['doc_a'],
            missingByProduct: [{ productId: 'p1', missing: ['doc_a'] }]
        });

        expect(warning).toEqual({
            code: 'MISSING_DOMESTIC_DOCUMENTS',
            message: 'Published with missing required domestic documents.',
            details: {
                market_code: 'VN',
                required_documents: ['doc_a'],
                missing_by_product: [{ productId: 'p1', missing: ['doc_a'] }]
            }
        });
    });

    it('falls back to sensible defaults when validationResult is missing', () => {
        const warning = buildDomesticComplianceWarning(undefined);
        expect(warning.details).toEqual({
            market_code: 'VN',
            required_documents: [],
            missing_by_product: []
        });
    });
});
