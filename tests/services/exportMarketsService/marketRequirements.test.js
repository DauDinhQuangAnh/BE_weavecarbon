const {
    DEFAULT_MARKET_CODES,
    DEFAULT_REQUIRED_DOCUMENTS,
    MATERIAL_CERTIFICATION_DOCUMENTS,
    MARKET_REQUIREMENTS_BY_CODE,
    resolveMarketName,
    getRequiredDocumentsForMarket,
    resolveDocumentTypeForMarket
} = require('../../../src/services/exportMarketsService/marketRequirements');

describe('market requirements catalog', () => {
    it('exposes the expected default market codes', () => {
        expect(DEFAULT_MARKET_CODES).toEqual(['VN', 'EU', 'US', 'JP', 'KR', 'AU', 'ASEAN']);
    });

    it('has a required-documents template with a code/name for every entry', () => {
        for (const doc of DEFAULT_REQUIRED_DOCUMENTS) {
            expect(typeof doc.code).toBe('string');
            expect(typeof doc.name).toBe('string');
        }
    });

    it('has a material certification catalog with a code/name for every entry', () => {
        for (const doc of MATERIAL_CERTIFICATION_DOCUMENTS) {
            expect(typeof doc.code).toBe('string');
            expect(typeof doc.name).toBe('string');
        }
    });

    it('defines requirements for every default market code', () => {
        for (const code of DEFAULT_MARKET_CODES) {
            expect(MARKET_REQUIREMENTS_BY_CODE[code]).toBeDefined();
            expect(Array.isArray(MARKET_REQUIREMENTS_BY_CODE[code].required_documents)).toBe(true);
        }
    });
});

describe('resolveMarketName', () => {
    it('returns the catalog display name for a known market code', () => {
        expect(resolveMarketName('EU')).toBe('European Union');
        expect(resolveMarketName('vn')).toBe('Vietnam');
    });

    it('falls back to a generated label for unknown market codes', () => {
        expect(resolveMarketName('ZZ')).toBe('Market ZZ');
    });

    it('handles nullish input', () => {
        expect(resolveMarketName(null)).toBe('Market ');
    });
});

describe('getRequiredDocumentsForMarket', () => {
    it('returns the market-specific document templates, normalizing codes', () => {
        const docs = getRequiredDocumentsForMarket('EU');
        expect(docs.map((d) => d.code)).toEqual(['cbam_declaration', 'dpp', 'supply_chain_map']);
        expect(docs[0]).toMatchObject({
            name: 'CBAM Declaration Form',
            document_type: 'declaration',
            regulation_reference: 'EU Regulation (EU) 2023/956'
        });
    });

    it('falls back to DEFAULT_REQUIRED_DOCUMENTS for markets without a specific catalog entry', () => {
        const docs = getRequiredDocumentsForMarket('ZZ');
        expect(docs.map((d) => d.code)).toEqual(DEFAULT_REQUIRED_DOCUMENTS.map((d) => d.code));
    });

    it('is case-insensitive on market code', () => {
        expect(getRequiredDocumentsForMarket('eu')).toEqual(getRequiredDocumentsForMarket('EU'));
    });
});

describe('resolveDocumentTypeForMarket', () => {
    it('returns the document_type for a known market/document pair', () => {
        expect(resolveDocumentTypeForMarket('EU', 'dpp')).toBe('report');
        expect(resolveDocumentTypeForMarket('EU', 'DPP')).toBe('report');
    });

    it('returns null when the document code is empty', () => {
        expect(resolveDocumentTypeForMarket('EU', '')).toBeNull();
        expect(resolveDocumentTypeForMarket('EU', null)).toBeNull();
    });

    it('returns null when the document is not part of the market template', () => {
        expect(resolveDocumentTypeForMarket('EU', 'not_a_real_code')).toBeNull();
    });
});
