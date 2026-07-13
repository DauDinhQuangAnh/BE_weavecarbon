jest.mock('../../../src/config/database', () => require('../../helpers/mockPool').createMockPool());

const pool = require('../../../src/config/database');
const {
    BULK_IMPORT_ENUMS,
    readBulkField,
    readBulkString,
    readBulkNumber,
    splitBulkList,
    addBulkValidationError,
    validateBulkImportRows
} = require('../../../src/services/productsService/bulkImportValidation');

function validRow(overrides = {}) {
    return {
        sku: 'SKU-1',
        productName: 'Organic Tee',
        productType: 'tshirt',
        quantity: 100,
        weightPerUnit: 200,
        primaryMaterial: 'organic_cotton',
        primaryMaterialPercentage: 80,
        secondaryMaterial: 'polyester',
        secondaryMaterialPercentage: 20,
        materialSource: 'domestic',
        processes: 'knitting,dyeing',
        energySource: 'grid',
        marketType: 'domestic',
        evidenceLookupCode: 'EVID-1',
        ...overrides
    };
}

describe('readBulkField / readBulkString / readBulkNumber', () => {
    it('reads the first matching field from the row payload', () => {
        expect(readBulkField({ sku: 'A' }, ['product_code', 'sku'])).toBe('A');
        expect(readBulkField({}, ['sku'], 'fallback')).toBe('fallback');
    });

    it('trims string values', () => {
        expect(readBulkString({ sku: '  A  ' }, ['sku'])).toBe('A');
    });

    it('parses numeric values with a fallback', () => {
        expect(readBulkNumber({ quantity: '10' }, ['quantity'])).toBe(10);
        expect(readBulkNumber({}, ['quantity'], 5)).toBe(5);
    });
});

describe('splitBulkList', () => {
    it('splits comma/semicolon/pipe separated strings', () => {
        expect(splitBulkList('a, b; c|d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('passes through and trims arrays', () => {
        expect(splitBulkList([' a ', 'b', ''])).toEqual(['a', 'b']);
    });
});

describe('addBulkValidationError', () => {
    it('pushes a structured error entry', () => {
        const errors = [];
        addBulkValidationError(errors, 'sku', 'SKU is required', 'REQUIRED');
        expect(errors).toEqual([{ field: 'sku', code: 'REQUIRED', message: 'SKU is required', severity: 'error' }]);
    });
});

describe('BULK_IMPORT_ENUMS', () => {
    it('exposes the expected enum sets', () => {
        expect(BULK_IMPORT_ENUMS.productType.has('tshirt')).toBe(true);
        expect(BULK_IMPORT_ENUMS.material.has('organic_cotton')).toBe(true);
        expect(BULK_IMPORT_ENUMS.transportMode.has('road')).toBe(true);
    });
});

describe('validateBulkImportRows', () => {
    beforeEach(() => {
        pool.query.mockReset();
    });

    it('accepts a fully valid row with no existing SKUs', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const result = await validateBulkImportRows('company-1', [validRow()]);

        expect(result.isValid).toBe(true);
        expect(result.errorCount).toBe(0);
        expect(result.validCount).toBe(1);
    });

    it('rejects a row missing a required field', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const result = await validateBulkImportRows('company-1', [validRow({ sku: '' })]);

        expect(result.isValid).toBe(false);
        expect(result.invalidRows[0].errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'sku', code: 'REQUIRED' })])
        );
    });

    it('flags a SKU that already exists in the database', async () => {
        pool.query.mockResolvedValue({ rows: [{ sku: 'SKU-1' }] });

        const result = await validateBulkImportRows('company-1', [validRow()]);

        expect(result.isValid).toBe(false);
        expect(result.invalidRows[0].errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'sku', code: 'DUPLICATE_SKU' })])
        );
    });

    it('flags duplicate SKUs within the same payload', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const result = await validateBulkImportRows('company-1', [validRow(), validRow()]);

        expect(result.invalidRows.length).toBe(1);
        expect(result.invalidRows[0].errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'sku', code: 'DUPLICATE_IN_PAYLOAD' })])
        );
    });

    it('rejects material percentages that sum above 100', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const result = await validateBulkImportRows(
            'company-1',
            [validRow({ primaryMaterialPercentage: 90, secondaryMaterialPercentage: 30 })]
        );

        expect(result.invalidRows[0].errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'materialPercentage' })])
        );
    });

    it('warns (but does not error) when evidenceLookupCode is missing', async () => {
        pool.query.mockResolvedValue({ rows: [] });

        const result = await validateBulkImportRows('company-1', [validRow({ evidenceLookupCode: '' })]);

        expect(result.isValid).toBe(true);
        expect(result.warnings).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'evidenceLookupCode' })])
        );
    });

    it('does not query the database when there are no candidate SKUs', async () => {
        await validateBulkImportRows('company-1', []);

        expect(pool.query).not.toHaveBeenCalled();
    });
});
