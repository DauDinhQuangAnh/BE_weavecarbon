const {
    normalizeDocumentToken,
    normalizeLooseDocumentToken,
    parseJsonObject,
    toNullableTrimmedString,
    toNonNegativeNumberOrNull,
    buildProductScopeNotes,
    resolveComplianceDocumentGroup
} = require('../../../src/services/exportMarketsService/normalizers');

describe('normalizeDocumentToken', () => {
    it('lowercases, trims and collapses non-alphanumeric runs to underscores', () => {
        expect(normalizeDocumentToken('  Carbon Footprint Report! ')).toBe('carbon_footprint_report');
    });

    it('handles nullish input', () => {
        expect(normalizeDocumentToken(null)).toBe('');
        expect(normalizeDocumentToken(undefined)).toBe('');
    });
});

describe('normalizeLooseDocumentToken', () => {
    it('strips underscores after normalizing', () => {
        expect(normalizeLooseDocumentToken('Material Cert')).toBe('materialcert');
    });
});

describe('parseJsonObject', () => {
    it('parses a JSON object string', () => {
        expect(parseJsonObject('{"note":"hi"}')).toEqual({ note: 'hi' });
    });

    it('returns null for arrays, invalid JSON, or non-string input', () => {
        expect(parseJsonObject('[1,2,3]')).toBeNull();
        expect(parseJsonObject('not json')).toBeNull();
        expect(parseJsonObject(null)).toBeNull();
        expect(parseJsonObject(42)).toBeNull();
    });
});

describe('toNullableTrimmedString', () => {
    it('trims non-empty values', () => {
        expect(toNullableTrimmedString('  hello  ')).toBe('hello');
    });

    it('returns null for nullish or empty-after-trim values', () => {
        expect(toNullableTrimmedString(null)).toBeNull();
        expect(toNullableTrimmedString(undefined)).toBeNull();
        expect(toNullableTrimmedString('   ')).toBeNull();
    });
});

describe('toNonNegativeNumberOrNull', () => {
    it('parses valid non-negative numbers', () => {
        expect(toNonNegativeNumberOrNull('12.5')).toBe(12.5);
        expect(toNonNegativeNumberOrNull(0)).toBe(0);
    });

    it('returns null for negative, NaN, or empty input', () => {
        expect(toNonNegativeNumberOrNull(-1)).toBeNull();
        expect(toNonNegativeNumberOrNull('abc')).toBeNull();
        expect(toNonNegativeNumberOrNull('')).toBeNull();
        expect(toNonNegativeNumberOrNull(null)).toBeNull();
    });
});

describe('buildProductScopeNotes', () => {
    it('merges new product data over previously stored metadata', () => {
        const existingNotes = JSON.stringify({ production_site: 'Hanoi', export_volume: 100, unit: 'kg' });
        const result = buildProductScopeNotes({ notes: 'updated note' }, existingNotes);

        expect(JSON.parse(result)).toEqual({
            note: 'updated note',
            production_site: 'Hanoi',
            export_volume: 100,
            unit: 'kg'
        });
    });

    it('defaults unit to pcs when nothing is stored', () => {
        const result = buildProductScopeNotes({}, null);
        expect(JSON.parse(result).unit).toBe('pcs');
    });
});

describe('resolveComplianceDocumentGroup', () => {
    it('classifies certificate-prefixed codes as material_certification', () => {
        expect(resolveComplianceDocumentGroup({ document_code: 'cert_gots' })).toBe('material_certification');
    });

    it('classifies material certificate type hints as material_certification', () => {
        expect(resolveComplianceDocumentGroup({ document_type: 'material_certification' })).toBe(
            'material_certification'
        );
    });

    it('defaults to export_compliance otherwise', () => {
        expect(resolveComplianceDocumentGroup({ document_code: 'carbon_footprint_report' })).toBe(
            'export_compliance'
        );
    });
});
