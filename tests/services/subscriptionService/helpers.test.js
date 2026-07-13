const helpers = require('../../../src/services/subscriptionService/helpers');

describe('buildError', () => {
    it('attaches code and statusCode to an Error', () => {
        const error = helpers.buildError('bad thing', 'BAD_CODE', 400);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('bad thing');
        expect(error.code).toBe('BAD_CODE');
        expect(error.statusCode).toBe(400);
    });
});

describe('toIsoOrNull', () => {
    it('converts valid dates to ISO strings', () => {
        expect(helpers.toIsoOrNull('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns null for falsy or invalid input', () => {
        expect(helpers.toIsoOrNull(null)).toBeNull();
        expect(helpers.toIsoOrNull('not-a-date')).toBeNull();
    });
});

describe('calcDaysRemaining', () => {
    it('returns 0 for falsy input', () => {
        expect(helpers.calcDaysRemaining(null)).toBe(0);
    });

    it('returns 0 for a past date', () => {
        expect(helpers.calcDaysRemaining(new Date(Date.now() - 86400000))).toBe(0);
    });

    it('returns a positive day count for a future date', () => {
        const result = helpers.calcDaysRemaining(new Date(Date.now() + 5 * 86400000));
        expect(result).toBeGreaterThanOrEqual(4);
        expect(result).toBeLessThanOrEqual(5);
    });
});

describe('normalizeMetadata', () => {
    it('returns plain objects unchanged', () => {
        expect(helpers.normalizeMetadata({ a: 1 })).toEqual({ a: 1 });
    });

    it('returns {} for arrays, null, and primitives', () => {
        expect(helpers.normalizeMetadata([1, 2])).toEqual({});
        expect(helpers.normalizeMetadata(null)).toEqual({});
        expect(helpers.normalizeMetadata('str')).toEqual({});
    });
});

describe('mergeMetadata', () => {
    it('merges patch over existing, skipping undefined values', () => {
        expect(helpers.mergeMetadata({ a: 1, b: 2 }, { b: 3, c: undefined, d: 4 })).toEqual({ a: 1, b: 3, d: 4 });
    });
});

describe('toPublicPaymentStatus', () => {
    it('maps internal statuses to public-facing ones', () => {
        expect(helpers.toPublicPaymentStatus('success')).toBe('paid');
        expect(helpers.toPublicPaymentStatus('expired')).toBe('expired');
        expect(helpers.toPublicPaymentStatus('failed')).toBe('failed');
        expect(helpers.toPublicPaymentStatus('cancelled')).toBe('failed');
        expect(helpers.toPublicPaymentStatus('pending')).toBe('pending');
        expect(helpers.toPublicPaymentStatus('anything_else')).toBe('pending');
    });
});

describe('isPaymentSessionExpired', () => {
    it('returns false when expires_at is missing', () => {
        expect(helpers.isPaymentSessionExpired({})).toBe(false);
    });

    it('returns true for a past expiry and false for a future one', () => {
        expect(helpers.isPaymentSessionExpired({ expires_at: new Date(Date.now() - 1000).toISOString() })).toBe(true);
        expect(helpers.isPaymentSessionExpired({ expires_at: new Date(Date.now() + 100000).toISOString() })).toBe(false);
    });
});
