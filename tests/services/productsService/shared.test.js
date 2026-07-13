const {
    toNumber,
    toPositiveInt,
    toPayloadObject,
    isNonEmptyString,
    safeArray
} = require('../../../src/services/productsService/shared');

describe('toNumber', () => {
    it('parses valid numeric input', () => {
        expect(toNumber('12.5')).toBe(12.5);
        expect(toNumber(3)).toBe(3);
    });

    it('returns the fallback for non-numeric input', () => {
        expect(toNumber('abc', 42)).toBe(42);
        expect(toNumber(undefined, -1)).toBe(-1);
        expect(toNumber(null)).toBe(0);
    });
});

describe('toPositiveInt', () => {
    it('parses positive integers', () => {
        expect(toPositiveInt('5')).toBe(5);
        expect(toPositiveInt(10.9)).toBe(10);
    });

    it('falls back for zero, negative, or non-numeric input', () => {
        expect(toPositiveInt(0, 7)).toBe(7);
        expect(toPositiveInt(-3, 7)).toBe(7);
        expect(toPositiveInt('abc', 7)).toBe(7);
        expect(toPositiveInt(undefined)).toBe(1);
    });
});

describe('toPayloadObject', () => {
    it('passes through plain objects', () => {
        expect(toPayloadObject({ a: 1 })).toEqual({ a: 1 });
    });

    it('parses JSON object strings', () => {
        expect(toPayloadObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('returns {} for arrays, invalid JSON, and nullish input', () => {
        expect(toPayloadObject([1, 2])).toEqual({});
        expect(toPayloadObject('not json')).toEqual({});
        expect(toPayloadObject(null)).toEqual({});
        expect(toPayloadObject(undefined)).toEqual({});
    });
});

describe('isNonEmptyString', () => {
    it('returns true for strings with visible content', () => {
        expect(isNonEmptyString('hello')).toBe(true);
    });

    it('returns false for empty/whitespace-only strings or non-strings', () => {
        expect(isNonEmptyString('   ')).toBe(false);
        expect(isNonEmptyString('')).toBe(false);
        expect(isNonEmptyString(42)).toBe(false);
        expect(isNonEmptyString(null)).toBe(false);
    });
});

describe('safeArray', () => {
    it('passes through arrays', () => {
        expect(safeArray([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('returns an empty array for non-array input', () => {
        expect(safeArray('not an array')).toEqual([]);
        expect(safeArray(null)).toEqual([]);
        expect(safeArray(undefined)).toEqual([]);
    });
});
