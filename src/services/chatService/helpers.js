const analyticsService = require('../analyticsService');
const logger = require('../../utils/logger');

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const toPositiveInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const truncateForLog = (value, maxLength = 120) => {
  const text = compactWhitespace(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const pickMetadataText = (metadata, keys) => {
  if (!isPlainObject(metadata)) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = truncateForLog(value);
      if (text) return text;
    }
  }

  return null;
};

const summarizeRagMetadatas = (metadatas) => {
  const items = Array.isArray(metadatas) ? metadatas : [];
  return {
    count: items.length,
    samples: items.slice(0, 3).map((metadata) => ({
      source: pickMetadataText(metadata, ['source', 'file_name', 'filename', 'document_name', 'title']),
      page: pickMetadataText(metadata, ['page', 'page_number']),
      collection: pickMetadataText(metadata, ['collection', 'collection_name'])
    }))
  };
};

const pushTransactionalAnalyticsEvent = async (client, eventIds, payload, scope) => {
  try {
    const event = await analyticsService.enqueueEvent(client, payload);
    if (event?.id) {
      eventIds.push(event.id);
    }
  } catch (error) {
    logger.error({ err: error }, `[chatService] Failed to queue ${scope}`);
  }
};

const safeTrackAnalyticsEvent = async (payload, scope) => {
  try {
    await analyticsService.trackEvent(payload);
  } catch (error) {
    logger.error({ err: error }, `[chatService] Failed to track ${scope}`);
  }
};

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

module.exports = {
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
};
