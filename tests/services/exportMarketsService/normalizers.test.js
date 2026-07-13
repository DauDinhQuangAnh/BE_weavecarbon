const {
    normalizeDocumentToken,
    normalizeLooseDocumentToken,
    normalizeDocumentCode,
    parseJsonObject,
    toNullableTrimmedString,
    toNonNegativeNumberOrNull,
    buildProductScopeNotes,
    resolveComplianceDocumentGroup,
    toDocumentStatus,
    readImportValue,
    normalizeImportStorageKey,
    normalizeImportDocumentCode,
    groupBy
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

describe('normalizeDocumentCode', () => {
    it('trims and lowercases without collapsing punctuation', () => {
        expect(normalizeDocumentCode('  CERT_gots  ')).toBe('cert_gots');
        expect(normalizeDocumentCode('Carbon Footprint Report')).toBe('carbon footprint report');
    });

    it('handles nullish input', () => {
        expect(normalizeDocumentCode(null)).toBe('');
        expect(normalizeDocumentCode(undefined)).toBe('');
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

describe('toDocumentStatus', () => {
    it('passes through known statuses', () => {
        expect(toDocumentStatus('missing')).toBe('missing');
        expect(toDocumentStatus('APPROVED')).toBe('approved');
        expect(toDocumentStatus(' expired ')).toBe('expired');
    });

    it('defaults unknown/empty statuses to uploaded', () => {
        expect(toDocumentStatus('bogus')).toBe('uploaded');
        expect(toDocumentStatus(null)).toBe('uploaded');
        expect(toDocumentStatus(undefined)).toBe('uploaded');
    });
});

describe('readImportValue', () => {
    it('returns the first non-empty matching key', () => {
        expect(readImportValue({ sku: '', product_code: 'ABC' }, ['sku', 'product_code'])).toBe('ABC');
    });

    it('returns an empty string when no key matches', () => {
        expect(readImportValue({}, ['sku', 'product_code'])).toBe('');
    });
});

describe('normalizeImportStorageKey', () => {
    it('converts backslashes to forward slashes and strips leading slashes', () => {
        expect(normalizeImportStorageKey('\\uploads\\file.pdf')).toBe('uploads/file.pdf');
    });

    it('neutralizes path traversal segments', () => {
        expect(normalizeImportStorageKey('../../etc/passwd')).toBe('_/_/etc/passwd');
    });
});

describe('normalizeImportDocumentCode', () => {
    it('lowercases and collapses non-alphanumeric runs to underscores', () => {
        expect(normalizeImportDocumentCode('Carbon Footprint Report!')).toBe('carbon_footprint_report');
    });

    it('handles nullish input', () => {
        expect(normalizeImportDocumentCode(null)).toBe('');
    });
});

describe('groupBy', () => {
    it('groups array items by the given key', () => {
        const items = [{ type: 'a', v: 1 }, { type: 'b', v: 2 }, { type: 'a', v: 3 }];
        expect(groupBy(items, 'type')).toEqual({
            a: [{ type: 'a', v: 1 }, { type: 'a', v: 3 }],
            b: [{ type: 'b', v: 2 }]
        });
    });

    it('returns an empty object for an empty array', () => {
        expect(groupBy([], 'type')).toEqual({});
    });
});
