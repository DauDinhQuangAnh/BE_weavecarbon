jest.mock('../../../src/services/analyticsService', () => ({
    enqueueEvent: jest.fn(),
    trackEvent: jest.fn()
}));

const analyticsService = require('../../../src/services/analyticsService');
const {
    isObject,
    toPositiveInt,
    compactWhitespace,
    truncateForLog,
    pickMetadataText,
    summarizeRagMetadatas,
    pushTransactionalAnalyticsEvent,
    safeTrackAnalyticsEvent,
    trimTrailingSlash,
    isPlainObject
} = require('../../../src/services/chatService/helpers');

describe('isObject / isPlainObject', () => {
    it('returns true for plain objects only', () => {
        expect(isObject({})).toBe(true);
        expect(isPlainObject({})).toBe(true);
        expect(isObject([])).toBe(false);
        expect(isObject(null)).toBe(false);
    });
});

describe('toPositiveInt', () => {
    it('clamps to the min/max range', () => {
        expect(toPositiveInt('50', 10, 1, 20)).toBe(20);
        expect(toPositiveInt('-5', 10, 1, 20)).toBe(1);
    });

    it('returns the fallback for non-integer input', () => {
        expect(toPositiveInt('abc', 7, 1, 20)).toBe(7);
    });
});

describe('compactWhitespace / truncateForLog', () => {
    it('collapses whitespace and trims', () => {
        expect(compactWhitespace('  a   b\n c ')).toBe('a b c');
    });

    it('truncates long text with an ellipsis', () => {
        const long = 'a'.repeat(150);
        const result = truncateForLog(long, 10);
        expect(result.length).toBe(10);
        expect(result.endsWith('…')).toBe(true);
    });

    it('leaves short text untouched', () => {
        expect(truncateForLog('short', 10)).toBe('short');
    });
});

describe('pickMetadataText', () => {
    it('returns the first matching string/number field', () => {
        expect(pickMetadataText({ source: 'file.pdf' }, ['source', 'file_name'])).toBe('file.pdf');
        expect(pickMetadataText({ page: 3 }, ['page'])).toBe('3');
    });

    it('returns null for non-plain-object metadata or no match', () => {
        expect(pickMetadataText(null, ['source'])).toBeNull();
        expect(pickMetadataText([], ['source'])).toBeNull();
        expect(pickMetadataText({}, ['source'])).toBeNull();
    });
});

describe('summarizeRagMetadatas', () => {
    it('summarizes up to 3 samples with count', () => {
        const metadatas = [
            { source: 'a.pdf' },
            { source: 'b.pdf' },
            { source: 'c.pdf' },
            { source: 'd.pdf' }
        ];
        const result = summarizeRagMetadatas(metadatas);
        expect(result.count).toBe(4);
        expect(result.samples).toHaveLength(3);
        expect(result.samples[0].source).toBe('a.pdf');
    });

    it('handles non-array input', () => {
        expect(summarizeRagMetadatas(null)).toEqual({ count: 0, samples: [] });
    });
});

describe('trimTrailingSlash', () => {
    it('removes trailing slashes', () => {
        expect(trimTrailingSlash('http://example.com/')).toBe('http://example.com');
        expect(trimTrailingSlash('http://example.com///')).toBe('http://example.com');
    });
});

describe('pushTransactionalAnalyticsEvent', () => {
    it('pushes the event id when enqueueEvent succeeds', async () => {
        analyticsService.enqueueEvent.mockResolvedValue({ id: 'evt-1' });
        const eventIds = [];
        await pushTransactionalAnalyticsEvent({}, eventIds, {}, 'test-scope');
        expect(eventIds).toEqual(['evt-1']);
    });

    it('swallows errors from enqueueEvent', async () => {
        analyticsService.enqueueEvent.mockRejectedValue(new Error('boom'));
        const eventIds = [];
        await expect(pushTransactionalAnalyticsEvent({}, eventIds, {}, 'test-scope')).resolves.toBeUndefined();
        expect(eventIds).toEqual([]);
    });
});

describe('safeTrackAnalyticsEvent', () => {
    it('swallows errors from trackEvent', async () => {
        analyticsService.trackEvent.mockRejectedValue(new Error('boom'));
        await expect(safeTrackAnalyticsEvent({}, 'test-scope')).resolves.toBeUndefined();
    });
});
