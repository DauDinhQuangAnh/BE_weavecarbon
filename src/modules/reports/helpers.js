const analyticsService = require('../shared/analytics');
const logger = require('../shared/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeUuid = (value) => {
    const text = String(value || '').trim();
    return UUID_REGEX.test(text) ? text : null;
};

const pushTransactionalAnalyticsEvent = async (client, eventIds, payload, scope) => {
    try {
        const event = await analyticsService.enqueueEvent(client, payload);
        if (event?.id) {
            eventIds.push(event.id);
        }
    } catch (error) {
        logger.error({ err: error }, `[reportsService] Failed to queue ${scope}`);
    }
};

const safeTrackAnalyticsEvent = async (payload, scope) => {
    try {
        await analyticsService.trackEvent(payload);
    } catch (error) {
        logger.error({ err: error }, `[reportsService] Failed to track ${scope}`);
    }
};

module.exports = {
    normalizeUuid,
    pushTransactionalAnalyticsEvent,
    safeTrackAnalyticsEvent
};
