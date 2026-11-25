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

const VI_GREETINGS = new Set([
  'xin chao',
  'chao',
  'chao ban',
  'chao weavey',
  'chao ai',
  'chao buoi sang',
  'chao buoi chieu',
  'chao buoi toi',
  'alo',
  'hello ban'
]);

const EN_GREETINGS = new Set([
  'hi',
  'hello',
  'hey',
  'helo',
  'halo',
  'hi weavey',
  'hello weavey',
  'good morning',
  'good afternoon',
  'good evening'
]);

const IDENTITY_QUERIES = new Set([
  'ban la ai',
  'weavey la ai',
  'weavey la gi',
  'ban lam duoc gi',
  'ban giup duoc gi',
  'giup toi',
  'huong dan',
  'help',
  'who are you',
  'what can you do'
]);

const GRATITUDE_QUERIES = new Set([
  'cam on',
  'cam on ban',
  'cam on weavey',
  'thanks',
  'thank you',
  'thank',
  'ok',
  'oke',
  'tam biet',
  'bye'
]);

const normalizeConversationalText = (value) =>
  compactWhitespace(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[!?.~,;:'"()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Returns a direct friendly response for simple greetings, identity questions,
 * or gratitude so strict RAG evidence guards do not reject small talk.
 */
const resolveConversationalReply = (content) => {
  const normalized = normalizeConversationalText(content);
  if (!normalized) return null;

  if (VI_GREETINGS.has(normalized)) {
    return 'Xin chào! Mình là Weavey, trợ lý AI của WeaveCarbon. Mình có thể hỗ trợ bạn tra cứu tiêu chuẩn kiểm kê phát thải (GHG Protocol, ISO 14064, EU CBAM), giải thích hệ số phát thải hoặc hướng dẫn sử dụng nền tảng. Bạn cần hỗ trợ nội dung nào?';
  }

  if (EN_GREETINGS.has(normalized)) {
    return "Hello! I'm Weavey, WeaveCarbon's AI assistant for carbon accounting and ESG compliance. How can I help you with CBAM, GHG Protocol, emission factors, or platform workflows today?";
  }

  if (IDENTITY_QUERIES.has(normalized)) {
    return 'Mình là Weavey — trợ lý AI chuyên trách về kiểm kê phát thải carbon của WeaveCarbon. Mình có thể hỗ trợ bạn:\n• Tra cứu quy định và tiêu chuẩn (GHG Protocol, ISO 14064, ISO 14067, EU CBAM, Nghị định 06).\n• Giải thích cách tính Scope 1, Scope 2, Scope 3 và hệ số phát thải.\n• Hướng dẫn quy trình nhập chứng từ, thiết lập cơ sở và xuất báo cáo trên WeaveCarbon.\nBạn hãy đặt câu hỏi cụ thể nhé!';
  }

  if (GRATITUDE_QUERIES.has(normalized)) {
    return 'Rất vui được hỗ trợ bạn! Nếu cần tra cứu thêm về dữ liệu phát thải hoặc quy định CBAM/ESG, bạn cứ nhắn mình nhé.';
  }

  return null;
};

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
  isPlainObject,
  resolveConversationalReply
};
