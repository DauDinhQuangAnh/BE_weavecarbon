const axios = require('axios');
const pool = require('../config/database');
const analyticsService = require('./analyticsService');
const { createAppError } = require('../utils/appError');
const logger = require('../utils/logger');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_NUMBER_DOCS_RETRIEVAL = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const TITLE_MAX_LENGTH = 80;
const PREVIEW_MAX_LENGTH = 120;
const DASHBOARD_CHAT_COLLECTION_NAME = 'weaveCarbon_1';
const DASHBOARD_CHAT_COLUMNS_TO_ANSWER = ['chunk'];
const GLOBAL_AI_RUNTIME_KEY = 'global';
const RAG_INTERNAL_API_KEY_HEADER = 'X-Internal-API-Key';

const {
  isObject,
  toPositiveInt,
  compactWhitespace,
  summarizeRagMetadatas,
  pushTransactionalAnalyticsEvent,
  safeTrackAnalyticsEvent,
  trimTrailingSlash,
  isPlainObject
} = require('./chatService/helpers');

class ChatService {
  logAiRequest(level, entry) {
    if (process.env.AI_REQUEST_LOGS === 'off') {
      return;
    }

    const logEntry = Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
    if (level === 'warn') {
      logger.warn(logEntry, '[ai]');
    } else {
      logger.info(logEntry, '[ai]');
    }
  }

  normalizeRagBaseUrl(value) {
    const raw = compactWhitespace(value);
    if (!raw) {
      throw createAppError('rag_base_url is required', {
        statusCode: 400,
        code: 'RAG_PROXY_BASE_URL_NOT_ALLOWED'
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(raw);
    } catch {
      throw createAppError('rag_base_url must be a valid absolute URL', {
        statusCode: 400,
        code: 'RAG_PROXY_BASE_URL_NOT_ALLOWED'
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw createAppError('rag_base_url must use http or https', {
        statusCode: 400,
        code: 'RAG_PROXY_BASE_URL_NOT_ALLOWED'
      });
    }

    const pathname =
      parsedUrl.pathname && parsedUrl.pathname !== '/' ? trimTrailingSlash(parsedUrl.pathname) : '';

    return trimTrailingSlash(`${parsedUrl.protocol}//${parsedUrl.host}${pathname}`);
  }

  getAllowedRagBaseUrls() {
    const raw =
      process.env.RAG_PROXY_ALLOWED_BASE_URLS || 'http://127.0.0.1:8000,http://localhost:8000';

    return new Set(
      raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          try {
            return this.normalizeRagBaseUrl(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );
  }

  assertAllowedRagBaseUrl(value) {
    const normalizedBaseUrl = this.normalizeRagBaseUrl(value);
    const allowlist = this.getAllowedRagBaseUrls();

    if (!allowlist.has(normalizedBaseUrl)) {
      throw createAppError('Configured RAG base URL is not in the allowed proxy list', {
        statusCode: 400,
        code: 'RAG_PROXY_BASE_URL_NOT_ALLOWED'
      });
    }

    return normalizedBaseUrl;
  }

  resolveRagRequestBaseUrl(value) {
    const normalizedBaseUrl = this.assertAllowedRagBaseUrl(value);
    const internalOverride = compactWhitespace(process.env.RAG_PROXY_INTERNAL_BASE_URL || '');

    if (!internalOverride) {
      return normalizedBaseUrl;
    }

    return this.normalizeRagBaseUrl(internalOverride);
  }

  isRagInternalApiKeyRequired() {
    const rawValue = compactWhitespace(process.env.RAG_REQUIRE_INTERNAL_API_KEY || 'true')
      .toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(rawValue);
  }

  getRagInternalApiKey() {
    const internalApiKey = compactWhitespace(process.env.RAG_INTERNAL_API_KEY || '');

    if (!internalApiKey && this.isRagInternalApiKeyRequired()) {
      throw createAppError('RAG internal authentication is not configured.', {
        statusCode: 503,
        code: 'RAG_INTERNAL_AUTH_NOT_CONFIGURED'
      });
    }

    return internalApiKey || null;
  }

  buildRagRequestHeaders(headers = {}) {
    const nextHeaders = { ...headers };
    const internalApiKey = this.getRagInternalApiKey();

    if (internalApiKey) {
      for (const headerName of Object.keys(nextHeaders)) {
        if (headerName.toLowerCase() === RAG_INTERNAL_API_KEY_HEADER.toLowerCase()) {
          delete nextHeaders[headerName];
        }
      }
      nextHeaders[RAG_INTERNAL_API_KEY_HEADER] = internalApiKey;
    }

    return nextHeaders;
  }

  getRagErrorDetail(error) {
    const responseData = error.response?.data;
    if (isPlainObject(responseData) && typeof responseData.detail === 'string') {
      return responseData.detail;
    }
    if (Array.isArray(responseData?.detail)) {
      return JSON.stringify(responseData.detail);
    }
    return error.message;
  }

  async callRagEndpoint(config, path, options = {}) {
    const baseUrl = this.resolveRagRequestBaseUrl(config.rag_base_url);
    const requestUrl = `${baseUrl}${path}`;
    const method = String(options.method || 'GET').toUpperCase();
    const startedAt = process.hrtime.bigint();
    const target = `${method} ${path}`;

    try {
      const response = await axios.request({
        url: requestUrl,
        method,
        data: options.data,
        params: options.params,
        timeout: options.timeout || config.timeout_ms || DEFAULT_TIMEOUT_MS,
        headers: this.buildRagRequestHeaders(options.headers || {})
      });

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logAiRequest('info', {
        target,
        status: response.status,
        duration_ms: Number(durationMs.toFixed(1))
      });

      return response.data;
    } catch (error) {
      if (error.code === 'RAG_PROXY_BASE_URL_NOT_ALLOWED') {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        this.logAiRequest('warn', {
          target,
          status: error.response?.status || 'network',
          duration_ms: Number(durationMs.toFixed(1)),
          code: error.code || 'RAG_BACKEND_ERROR'
        });

        if (error.code === 'ECONNREFUSED') {
          throw createAppError('Unable to connect to the RAG backend service.', {
            statusCode: 502,
            code: 'RAG_BACKEND_UNAVAILABLE'
          });
        }

        if (error.code === 'ECONNABORTED') {
          throw createAppError('RAG backend request timed out', {
            statusCode: 504,
            code: 'RAG_BACKEND_TIMEOUT'
          });
        }

        const upstreamStatus = error.response?.status || null;
        const detail = this.getRagErrorDetail(error);
        throw createAppError(detail || 'Failed to fetch a response from the RAG backend', {
          statusCode: upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 ? upstreamStatus : 502,
          code: 'RAG_BACKEND_ERROR'
        });
      }

      if (error.statusCode && error.code) {
        throw error;
      }

      throw createAppError('Failed to fetch a response from the RAG backend', {
        statusCode: 502,
        code: 'RAG_BACKEND_ERROR'
      });
    }
  }

  async callGlobalRagEndpoint(path, options = {}) {
    const config = await this.resolveGlobalRuntimeConfig();
    return this.callRagEndpoint(config, path, options);
  }

  getFallbackDashboardChatConfig() {
    const allowedBaseUrl = Array.from(this.getAllowedRagBaseUrls())[0] || null;

    if (!allowedBaseUrl) {
      throw createAppError('Dashboard AI chat is not configured on the server.', {
        statusCode: 500,
        code: 'CHAT_CONFIG_MISSING'
      });
    }

    return {
      rag_base_url: allowedBaseUrl,
      collection_name: DASHBOARD_CHAT_COLLECTION_NAME,
      columns_to_answer: [...DASHBOARD_CHAT_COLUMNS_TO_ANSWER],
      number_docs_retrieval: DEFAULT_NUMBER_DOCS_RETRIEVAL,
      timeout_ms: DEFAULT_TIMEOUT_MS
    };
  }

  normalizeColumns(columns) {
    if (!Array.isArray(columns)) return [];

    return columns
      .map((item) => compactWhitespace(item))
      .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);
  }

  generateConversationTitle(content) {
    const normalized = compactWhitespace(content);
    if (normalized.length <= TITLE_MAX_LENGTH) {
      return normalized;
    }

    return `${normalized.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}...`;
  }

  buildPreview(content) {
    const normalized = compactWhitespace(content);
    if (normalized.length <= PREVIEW_MAX_LENGTH) {
      return normalized;
    }

    return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}...`;
  }

  normalizeConfigRow(row) {
    if (!row) return null;

    const config = {
      rag_base_url: row.rag_base_url,
      collection_name: row.collection_name,
      columns_to_answer: Array.isArray(row.columns_to_answer) ? row.columns_to_answer : [],
      number_docs_retrieval:
        toPositiveInt(row.number_docs_retrieval, DEFAULT_NUMBER_DOCS_RETRIEVAL, 1, 50),
      timeout_ms: toPositiveInt(row.timeout_ms, DEFAULT_TIMEOUT_MS, 1000, 120000)
    };

    if (
      !compactWhitespace(config.rag_base_url) ||
      !compactWhitespace(config.collection_name)
    ) {
      return null;
    }

    if (config.columns_to_answer.length === 0) {
      config.columns_to_answer = [...DASHBOARD_CHAT_COLUMNS_TO_ANSWER];
    }

    return config;
  }

  validateRuntimeConfigPayload(payload) {
    const normalizedBaseUrl = this.assertAllowedRagBaseUrl(payload.rag_base_url);
    const collectionName = compactWhitespace(payload.collection_name);
    const columnsToAnswer = this.normalizeColumns(payload.columns_to_answer);

    if (!collectionName) {
      throw createAppError('collection_name is required', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    return {
      rag_base_url: normalizedBaseUrl,
      collection_name: collectionName,
      columns_to_answer:
        columnsToAnswer.length > 0 ? columnsToAnswer : [...DASHBOARD_CHAT_COLUMNS_TO_ANSWER],
      number_docs_retrieval: toPositiveInt(
        payload.number_docs_retrieval,
        DEFAULT_NUMBER_DOCS_RETRIEVAL,
        1,
        50
      ),
      timeout_ms: toPositiveInt(payload.timeout_ms, DEFAULT_TIMEOUT_MS, 1000, 120000)
    };
  }

  async getMembership(userId, companyId) {
    const result = await pool.query(
      `
        SELECT role, status
        FROM public.company_members
        WHERE user_id = $1 AND company_id = $2
        LIMIT 1
      `,
      [userId, companyId]
    );

    return result.rows[0] || null;
  }

  async resolveChatSettings(userId, companyId) {
    const membership = await this.getMembership(userId, companyId);
    const canEdit = membership?.role === 'admin' && membership?.status === 'active';

    if (canEdit) {
      const selfResult = await pool.query(
        `
          SELECT rag_base_url, collection_name, columns_to_answer, number_docs_retrieval, timeout_ms
          FROM public.chat_runtime_settings
          WHERE user_id = $1 AND company_id = $2
          LIMIT 1
        `,
        [userId, companyId]
      );

      if (selfResult.rows.length > 0) {
        return {
          config: this.normalizeConfigRow(selfResult.rows[0]),
          config_source: 'self',
          can_edit: true
        };
      }
    }

    const inheritedResult = await pool.query(
      `
        SELECT
          s.user_id,
          s.rag_base_url,
          s.collection_name,
          s.columns_to_answer,
          s.number_docs_retrieval,
          s.timeout_ms
        FROM public.chat_runtime_settings s
        JOIN public.company_members cm
          ON cm.user_id = s.user_id
         AND cm.company_id = s.company_id
        WHERE s.company_id = $1
          AND cm.role = 'admin'
          AND cm.status = 'active'
        ORDER BY
          CASE WHEN s.user_id = $2 THEN 0 ELSE 1 END,
          s.updated_at DESC
        LIMIT 1
      `,
      [companyId, userId]
    );

    if (inheritedResult.rows.length === 0) {
      return {
        config: null,
        config_source: null,
        can_edit: canEdit
      };
    }

    const inheritedRow = inheritedResult.rows[0];
    const source = inheritedRow.user_id === userId ? 'self' : 'company_admin';

    return {
      config: this.normalizeConfigRow(inheritedRow),
      config_source: source,
      can_edit: canEdit
    };
  }

  async listConversations(userId, companyId, pagination = {}) {
    const page = toPositiveInt(pagination.page, DEFAULT_PAGE, 1, 100000);
    const pageSize = toPositiveInt(pagination.page_size, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const [{ rows: countRows }, { rows: conversationRows }] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM public.chat_conversations
          WHERE user_id = $1 AND company_id = $2
        `,
        [userId, companyId]
      ),
      pool.query(
        `
          SELECT
            c.id,
            c.title,
            c.created_at,
            c.updated_at,
            COALESCE(message_stats.message_count, 0)::int AS message_count,
            COALESCE(last_message.content, '') AS last_message_preview
          FROM public.chat_conversations c
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS message_count
            FROM public.chat_messages m
            WHERE m.conversation_id = c.id
          ) message_stats ON TRUE
          LEFT JOIN LATERAL (
            SELECT m.content
            FROM public.chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ) last_message ON TRUE
          WHERE c.user_id = $1 AND c.company_id = $2
          ORDER BY c.updated_at DESC
          LIMIT $3 OFFSET $4
        `,
        [userId, companyId, pageSize, offset]
      )
    ]);

    const total = countRows[0]?.total || 0;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

    return {
      items: conversationRows.map((row) => ({
        id: row.id,
        title: row.title || 'New chat',
        created_at: row.created_at,
        updated_at: row.updated_at,
        message_count: Number(row.message_count) || 0,
        last_message_preview: this.buildPreview(row.last_message_preview || '')
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages
      }
    };
  }

  async getConversationDetail(userId, companyId, conversationId) {
    const conversationResult = await pool.query(
      `
        SELECT id, title, created_at, updated_at
        FROM public.chat_conversations
        WHERE id = $1 AND user_id = $2 AND company_id = $3
        LIMIT 1
      `,
      [conversationId, userId, companyId]
    );

    if (conversationResult.rows.length === 0) {
      throw createAppError('Conversation not found', {
        statusCode: 404,
        code: 'CHAT_CONVERSATION_NOT_FOUND'
      });
    }

    const messagesResult = await pool.query(
      `
        SELECT id, role, content, metadata, created_at
        FROM public.chat_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [conversationId]
    );

    return {
      ...conversationResult.rows[0],
      messages: messagesResult.rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        metadata: isObject(row.metadata) ? row.metadata : {},
        created_at: row.created_at
      }))
    };
  }

  async getStoredGlobalRuntimeConfig() {
    try {
      const result = await pool.query(
        `
          SELECT rag_base_url, collection_name, columns_to_answer, number_docs_retrieval, timeout_ms
          FROM public.global_ai_runtime_settings
          WHERE singleton_key = $1
          LIMIT 1
        `,
        [GLOBAL_AI_RUNTIME_KEY]
      );

      return this.normalizeConfigRow(result.rows[0]);
    } catch (error) {
      if (error?.code === '42P01') {
        return null;
      }
      throw error;
    }
  }

  async resolveGlobalRuntimeConfig() {
    const storedConfig = await this.getStoredGlobalRuntimeConfig();
    if (storedConfig) {
      return storedConfig;
    }

    return this.getFallbackDashboardChatConfig();
  }

  async resolveRuntimeConfigForCompany(userId, companyId) {
    const companySettings = await this.resolveChatSettings(userId, companyId);
    if (companySettings.config) {
      return {
        config: companySettings.config,
        config_source: companySettings.config_source || 'company_admin'
      };
    }

    return {
      config: await this.resolveGlobalRuntimeConfig(),
      config_source: 'global'
    };
  }

  async upsertGlobalRuntimeConfig(payload) {
    const config = this.validateRuntimeConfigPayload(payload);

    try {
      const result = await pool.query(
        `
          INSERT INTO public.global_ai_runtime_settings (
            singleton_key,
            rag_base_url,
            collection_name,
            columns_to_answer,
            number_docs_retrieval,
            timeout_ms
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (singleton_key)
          DO UPDATE SET
            rag_base_url = EXCLUDED.rag_base_url,
            collection_name = EXCLUDED.collection_name,
            columns_to_answer = EXCLUDED.columns_to_answer,
            number_docs_retrieval = EXCLUDED.number_docs_retrieval,
            timeout_ms = EXCLUDED.timeout_ms,
            updated_at = NOW()
          RETURNING rag_base_url, collection_name, columns_to_answer, number_docs_retrieval, timeout_ms
        `,
        [
          GLOBAL_AI_RUNTIME_KEY,
          config.rag_base_url,
          config.collection_name,
          config.columns_to_answer,
          config.number_docs_retrieval,
          config.timeout_ms
        ]
      );

      return this.normalizeConfigRow(result.rows[0]);
    } catch (error) {
      if (error?.code === '42P01') {
        throw createAppError('Global AI runtime table is missing. Please run the latest database migration.', {
          statusCode: 503,
          code: 'GLOBAL_AI_RUNTIME_TABLE_MISSING'
        });
      }
      throw error;
    }
  }

  async deleteConversation(userId, companyId, conversationId) {
    const result = await pool.query(
      `
        DELETE FROM public.chat_conversations
        WHERE id = $1 AND user_id = $2 AND company_id = $3
        RETURNING id, title
      `,
      [conversationId, userId, companyId]
    );

    if (result.rows.length === 0) {
      throw createAppError('Conversation not found', {
        statusCode: 404,
        code: 'CHAT_CONVERSATION_NOT_FOUND'
      });
    }

    await safeTrackAnalyticsEvent({
      event_name: 'wc_chat_conversation_deleted',
      user_id: userId,
      company_id: companyId,
      entity_type: 'chat_conversation',
      entity_id: conversationId,
      payload: {
        variant: 'dashboard'
      }
    }, 'wc_chat_conversation_deleted');

    return {
      id: result.rows[0].id,
      title: result.rows[0].title || 'New chat'
    };
  }

  async upsertSettings(userId, companyId, payload) {
    const config = this.validateRuntimeConfigPayload(payload);

    const result = await pool.query(
      `
        INSERT INTO public.chat_runtime_settings (
          user_id,
          company_id,
          rag_base_url,
          collection_name,
          columns_to_answer,
          number_docs_retrieval,
          timeout_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id)
        DO UPDATE SET
          company_id = EXCLUDED.company_id,
          rag_base_url = EXCLUDED.rag_base_url,
          collection_name = EXCLUDED.collection_name,
          columns_to_answer = EXCLUDED.columns_to_answer,
          number_docs_retrieval = EXCLUDED.number_docs_retrieval,
          timeout_ms = EXCLUDED.timeout_ms,
          updated_at = NOW()
        RETURNING rag_base_url, collection_name, columns_to_answer, number_docs_retrieval, timeout_ms
      `,
      [
        userId,
        companyId,
        config.rag_base_url,
        config.collection_name,
        config.columns_to_answer,
        config.number_docs_retrieval,
        config.timeout_ms
      ]
    );

    const normalizedConfig = this.normalizeConfigRow(result.rows[0]);
    await safeTrackAnalyticsEvent({
      event_name: 'wc_chat_settings_saved',
      user_id: userId,
      company_id: companyId,
      payload: {
        variant: 'dashboard'
      }
    }, 'wc_chat_settings_saved');

    return normalizedConfig;
  }

  async resolveConversationForSend(userId, companyId, conversationId) {
    if (!conversationId) {
      return null;
    }

    const result = await pool.query(
      `
        SELECT id, title, created_at, updated_at
        FROM public.chat_conversations
        WHERE id = $1 AND user_id = $2 AND company_id = $3
        LIMIT 1
      `,
      [conversationId, userId, companyId]
    );

    if (result.rows.length === 0) {
      throw createAppError('Conversation not found', {
        statusCode: 404,
        code: 'CHAT_CONVERSATION_NOT_FOUND'
      });
    }

    return result.rows[0];
  }

  async callRagQuery(config, content) {
    try {
      const payload = await this.callRagEndpoint(
        config,
        `/collections/${encodeURIComponent(config.collection_name)}/query`,
        {
          method: 'POST',
          data: {
            query: content,
            columns_to_answer: config.columns_to_answer?.length
              ? config.columns_to_answer
              : [...DASHBOARD_CHAT_COLUMNS_TO_ANSWER],
            number_docs_retrieval: config.number_docs_retrieval
          },
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const responsePayload = isObject(payload) ? payload : {};
      const answer = compactWhitespace(responsePayload.answer || responsePayload.retrieved_data || '');
      if (!answer) {
        throw createAppError('RAG backend returned an empty answer', {
          statusCode: 502,
          code: 'CHAT_SEND_FAILED'
        });
      }

      return {
        answer,
        rag_response: responsePayload
      };
    } catch (error) {
      if (error.code === 'RAG_PROXY_BASE_URL_NOT_ALLOWED') {
        throw error;
      }

      if (error.code === 'RAG_BACKEND_ERROR' || error.code === 'RAG_BACKEND_TIMEOUT' || error.code === 'RAG_BACKEND_UNAVAILABLE') {
        throw createAppError(error.message, {
          statusCode: error.statusCode,
          code: 'CHAT_SEND_FAILED'
        });
      }

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw createAppError('Unable to connect to the RAG backend service.', {
            statusCode: 502,
            code: 'CHAT_SEND_FAILED'
          });
        }

        if (error.code === 'ECONNABORTED') {
          throw createAppError('RAG backend request timed out', {
            statusCode: 504,
            code: 'CHAT_SEND_FAILED'
          });
        }

        const responseData = error.response?.data;
        const detail =
          isPlainObject(responseData) && typeof responseData.detail === 'string' ?
            responseData.detail :
            Array.isArray(responseData?.detail) ?
              JSON.stringify(responseData.detail) :
              error.message;
        const upstreamStatus = error.response?.status || null;

        if (upstreamStatus === 400 || upstreamStatus === 422) {
          throw createAppError(detail || 'Invalid request sent to the RAG backend', {
            statusCode: 400,
            code: 'CHAT_SEND_FAILED'
          });
        }

        if (upstreamStatus === 404) {
          throw createAppError(
            `AI collection "${config.collection_name}" was not found in the RAG backend.`,
            {
              statusCode: 502,
              code: 'CHAT_SEND_FAILED'
            }
          );
        }

        if (upstreamStatus === 429) {
          throw createAppError('RAG backend is busy. Please try again shortly.', {
            statusCode: 503,
            code: 'CHAT_SEND_FAILED'
          });
        }

        throw createAppError(detail || 'Failed to fetch a response from the RAG backend', {
          statusCode: upstreamStatus && upstreamStatus >= 500 ? 502 : 500,
          code: 'CHAT_SEND_FAILED'
        });
      }

      if (error.statusCode && error.code) {
        throw error;
      }

      throw createAppError('Failed to fetch a response from the RAG backend', {
        statusCode: 502,
        code: 'CHAT_SEND_FAILED'
      });
    }
  }

  async callRagRecommendation(config, path, payload) {
    try {
      const response = await this.callRagEndpoint(config, path, {
        method: 'POST',
        data: payload,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!isPlainObject(response)) {
        throw createAppError('RAG backend returned an invalid response', {
          statusCode: 502,
          code: 'CHAT_SEND_FAILED'
        });
      }

      return response;
    } catch (error) {
      if (error.code === 'RAG_PROXY_BASE_URL_NOT_ALLOWED') {
        throw error;
      }

      if (error.code === 'RAG_BACKEND_ERROR' || error.code === 'RAG_BACKEND_TIMEOUT' || error.code === 'RAG_BACKEND_UNAVAILABLE') {
        throw createAppError(error.message, {
          statusCode: error.statusCode,
          code: 'CHAT_SEND_FAILED'
        });
      }

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw createAppError('Unable to connect to the RAG backend service.', {
            statusCode: 502,
            code: 'CHAT_SEND_FAILED'
          });
        }

        if (error.code === 'ECONNABORTED') {
          throw createAppError('RAG backend request timed out', {
            statusCode: 504,
            code: 'CHAT_SEND_FAILED'
          });
        }

        const responseData = error.response?.data;
        const detail =
          isPlainObject(responseData) && typeof responseData.detail === 'string' ?
            responseData.detail :
            Array.isArray(responseData?.detail) ?
              JSON.stringify(responseData.detail) :
              error.message;
        const upstreamStatus = error.response?.status || null;

        if (upstreamStatus === 400 || upstreamStatus === 422) {
          throw createAppError(detail || 'Invalid request sent to the RAG backend', {
            statusCode: 400,
            code: 'CHAT_SEND_FAILED'
          });
        }

        if (upstreamStatus === 404) {
          throw createAppError(detail || 'Requested AI context was not found in the RAG backend.', {
            statusCode: 502,
            code: 'CHAT_SEND_FAILED'
          });
        }

        if (upstreamStatus === 429) {
          throw createAppError('RAG backend is busy. Please try again shortly.', {
            statusCode: 503,
            code: 'CHAT_SEND_FAILED'
          });
        }

        throw createAppError(detail || 'Failed to fetch a response from the RAG backend', {
          statusCode: upstreamStatus && upstreamStatus >= 500 ? 502 : 500,
          code: 'CHAT_SEND_FAILED'
        });
      }

      if (error.statusCode && error.code) {
        throw error;
      }

      throw createAppError('Failed to fetch a response from the RAG backend', {
        statusCode: 502,
        code: 'CHAT_SEND_FAILED'
      });
    }
  }

  async assertCompanyAccess(companyId, requestedCompanyId, bodyCompanyId) {
    if (bodyCompanyId && bodyCompanyId !== requestedCompanyId) {
      throw createAppError('company_id in path and body must match.', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    if (requestedCompanyId !== companyId) {
      throw createAppError('Company is outside the current user context', {
        statusCode: 403,
        code: 'FORBIDDEN'
      });
    }
  }

  async assertProductAccess(companyId, requestedProductId, bodyProductId) {
    if (bodyProductId && bodyProductId !== requestedProductId) {
      throw createAppError('product_id in path and body must match.', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    const result = await pool.query(
      `
        SELECT id
        FROM public.products
        WHERE id = $1 AND company_id = $2
        LIMIT 1
      `,
      [requestedProductId, companyId]
    );

    if (result.rows.length === 0) {
      throw createAppError('Product not found', {
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND'
      });
    }
  }

  async generateCompanyRecommendations(userId, companyId, requestedCompanyId, payload = {}) {
    await this.assertCompanyAccess(companyId, requestedCompanyId, payload.company_id);

    const runtime = await this.resolveRuntimeConfigForCompany(userId, companyId);
    const response = await this.callRagRecommendation(
      runtime.config,
      `/recommendations/company/${encodeURIComponent(requestedCompanyId)}`,
      {
        company_id: requestedCompanyId,
        language: compactWhitespace(payload.language) || 'vi'
      }
    );

    return {
      ...response,
      config_source: runtime.config_source
    };
  }

  async generateProductSuggestions(userId, companyId, requestedProductId, payload = {}) {
    await this.assertProductAccess(companyId, requestedProductId, payload.product_id);

    const runtime = await this.resolveRuntimeConfigForCompany(userId, companyId);
    const response = await this.callRagRecommendation(
      runtime.config,
      `/recommendations/product/${encodeURIComponent(requestedProductId)}`,
      {
        product_id: requestedProductId,
        language: compactWhitespace(payload.language) || 'vi'
      }
    );

    return {
      ...response,
      config_source: runtime.config_source
    };
  }

  buildMissingConfigError(canEdit) {
    return createAppError(
      canEdit ?
        'Chat AI settings are not configured. Please save Settings > AI first.' :
        'Chat AI settings are not configured. Please ask your company admin to configure Settings > AI.',
      {
        statusCode: 400,
        code: 'CHAT_CONFIG_MISSING'
      }
    );
  }

  async sendMessage(userId, companyId, payload) {
    const content = compactWhitespace(payload.content);

    if (!content) {
      throw createAppError('content is required', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    const existingConversation = await this.resolveConversationForSend(
      userId,
      companyId,
      payload.conversation_id
    );
    const runtime = await this.resolveRuntimeConfigForCompany(userId, companyId);
    const dashboardChatConfig = runtime.config;
    const ragResult = await this.callRagQuery(dashboardChatConfig, content);
    const client = await pool.connect();
    const analyticsEventIds = [];

    try {
      await client.query('BEGIN');

      let conversation = existingConversation;
      if (!conversation) {
        const createConversationResult = await client.query(
          `
            INSERT INTO public.chat_conversations (user_id, company_id, title, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id, title, created_at, updated_at
          `,
          [userId, companyId, this.generateConversationTitle(content)]
        );
        conversation = createConversationResult.rows[0];
      }

      const userMessageMetadata = {};
      if (payload.current_page) {
        userMessageMetadata.current_page = payload.current_page;
      }

      const userMessageResult = await client.query(
        `
          INSERT INTO public.chat_messages (conversation_id, role, content, metadata, created_at)
          VALUES ($1, 'user', $2, $3::jsonb, NOW())
          RETURNING id, role, content, metadata, created_at
        `,
        [conversation.id, content, JSON.stringify(userMessageMetadata)]
      );

      const assistantMetadata = {
        config_source: runtime.config_source,
        collection_name: dashboardChatConfig.collection_name,
        rag_metadatas: summarizeRagMetadatas(ragResult.rag_response.metadatas)
      };

      const assistantMessageResult = await client.query(
        `
          INSERT INTO public.chat_messages (conversation_id, role, content, metadata, created_at)
          VALUES ($1, 'assistant', $2, $3::jsonb, NOW())
          RETURNING id, role, content, metadata, created_at
        `,
        [conversation.id, ragResult.answer, JSON.stringify(assistantMetadata)]
      );

      const updateConversationResult = await client.query(
        `
          UPDATE public.chat_conversations
          SET updated_at = NOW()
          WHERE id = $1
          RETURNING id, title, created_at, updated_at
        `,
        [conversation.id]
      );

      const messageCountResult = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM public.chat_messages
          WHERE conversation_id = $1
        `,
        [conversation.id]
      );

      await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
        event_name: 'wc_chat_message_sent',
        user_id: userId,
        company_id: companyId,
        entity_type: 'chat_conversation',
        entity_id: conversation.id,
        payload: {
          has_conversation: Boolean(existingConversation),
          variant: 'dashboard'
        }
      }, 'wc_chat_message_sent');

      await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
        event_name: 'wc_chat_response_received',
        user_id: userId,
        company_id: companyId,
        entity_type: 'chat_conversation',
        entity_id: conversation.id,
        payload: {
          variant: 'dashboard'
        }
      }, 'wc_chat_response_received');

      await client.query('COMMIT');
      analyticsService.queuePendingDispatch(analyticsEventIds);

      const latestConversation = updateConversationResult.rows[0];

      return {
        conversation: {
          id: latestConversation.id,
          title: latestConversation.title,
          created_at: latestConversation.created_at,
          updated_at: latestConversation.updated_at,
          message_count: messageCountResult.rows[0]?.total || 0,
          last_message_preview: this.buildPreview(ragResult.answer)
        },
        user_message: {
          ...userMessageResult.rows[0],
          metadata: isObject(userMessageResult.rows[0].metadata) ? userMessageResult.rows[0].metadata : {}
        },
        assistant_message: {
          ...assistantMessageResult.rows[0],
          metadata: isObject(assistantMessageResult.rows[0].metadata) ?
            assistantMessageResult.rows[0].metadata :
            {}
        },
        config_source: runtime.config_source
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new ChatService();
