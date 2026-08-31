jest.mock('../../../src/services/analyticsService', () => ({
    enqueueEvent: jest.fn(),
    trackEvent: jest.fn()
}));
jest.mock('../../../src/modules/shared/logger', () => ({
    error: jest.fn()
}));

const analyticsService = require('../../../src/services/analyticsService');
const {
    normalizeUuid,
    pushTransactionalAnalyticsEvent,
    safeTrackAnalyticsEvent
} = require('../../../src/services/reportsService/helpers');

describe('normalizeUuid', () => {
    it('returns the trimmed value when it matches the UUID format', () => {
        expect(normalizeUuid('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(
            '550e8400-e29b-41d4-a716-446655440000'
        );
    });

    it('returns null for non-UUID input', () => {
        expect(normalizeUuid('not-a-uuid')).toBeNull();
        expect(normalizeUuid(null)).toBeNull();
        expect(normalizeUuid(undefined)).toBeNull();
    });
});

describe('pushTransactionalAnalyticsEvent', () => {
    it('pushes the event id on success', async () => {
        analyticsService.enqueueEvent.mockResolvedValue({ id: 'evt-1' });
        const eventIds = [];
        await pushTransactionalAnalyticsEvent({}, eventIds, {}, 'scope');
        expect(eventIds).toEqual(['evt-1']);
    });

    it('swallows errors', async () => {
        analyticsService.enqueueEvent.mockRejectedValue(new Error('boom'));
        const eventIds = [];
        await expect(pushTransactionalAnalyticsEvent({}, eventIds, {}, 'scope')).resolves.toBeUndefined();
        expect(eventIds).toEqual([]);
    });
});

describe('safeTrackAnalyticsEvent', () => {
    it('swallows errors from trackEvent', async () => {
        analyticsService.trackEvent.mockRejectedValue(new Error('boom'));
        await expect(safeTrackAnalyticsEvent({}, 'scope')).resolves.toBeUndefined();
    });
});
