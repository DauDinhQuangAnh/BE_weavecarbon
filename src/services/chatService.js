const axios = require('axios');
const pool = require('../config/database');
const { createAppError } = require('../utils/appError');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_NUMBER_DOCS_RETRIEVAL = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const TITLE_MAX_LENGTH = 80;
const PREVIEW_MAX_LENGTH = 120;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const toPositiveInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

class ChatService {
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

    return {
      rag_base_url: row.rag_base_url,
      collection_name: row.collection_name,
      columns_to_answer: Array.isArray(row.columns_to_answer) ? row.columns_to_answer : [],
      number_docs_retrieval:
        toPositiveInt(row.number_docs_retrieval, DEFAULT_NUMBER_DOCS_RETRIEVAL, 1, 50),
      timeout_ms: toPositiveInt(row.timeout_ms, DEFAULT_TIMEOUT_MS, 1000, 120000)
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

  async upsertSettings(userId, companyId, payload) {
    const normalizedBaseUrl = this.assertAllowedRagBaseUrl(payload.rag_base_url);
    const collectionName = compactWhitespace(payload.collection_name);
    const columnsToAnswer = this.normalizeColumns(payload.columns_to_answer);

    if (!collectionName) {
      throw createAppError('collection_name is required', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    if (columnsToAnswer.length === 0) {
      throw createAppError('columns_to_answer must contain at least one column', {
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }

    const numberDocsRetrieval = toPositiveInt(
      payload.number_docs_retrieval,
      DEFAULT_NUMBER_DOCS_RETRIEVAL,
      1,
      50
    );
    const timeoutMs = toPositiveInt(payload.timeout_ms, DEFAULT_TIMEOUT_MS, 1000, 120000);

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
        normalizedBaseUrl,
        collectionName,
        columnsToAnswer,
        numberDocsRetrieval,
        timeoutMs
      ]
    );

    return this.normalizeConfigRow(result.rows[0]);
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
    const baseUrl = this.assertAllowedRagBaseUrl(config.rag_base_url);
    const requestUrl = `${baseUrl}/collections/${encodeURIComponent(config.collection_name)}/query`;

    try {
      const response = await axios.post(
        requestUrl,
        {
          query: content,
          columns_to_answer: config.columns_to_answer,
          number_docs_retrieval: config.number_docs_retrieval
        },
        {
          timeout: config.timeout_ms,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const payload = isObject(response.data) ? response.data : {};
      const answer = compactWhitespace(payload.answer || payload.retrieved_data || '');
      if (!answer) {
        throw createAppError('RAG backend returned an empty answer', {
          statusCode: 502,
          code: 'CHAT_SEND_FAILED'
        });
      }

      return {
        answer,
        rag_response: payload
      };
    } catch (error) {
      if (error.code === 'RAG_PROXY_BASE_URL_NOT_ALLOWED') {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw createAppError('RAG backend request timed out', {
            statusCode: 504,
            code: 'CHAT_SEND_FAILED'
          });
        }

        const detail =
          error.response && isObject(error.response.data) && typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : error.message;

        throw createAppError(detail || 'Failed to fetch a response from the RAG backend', {
          statusCode: 502,
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
    const existingConversation = await this.resolveConversationForSend(
      userId,
      companyId,
      payload.conversation_id
    );
    const resolvedSettings = await this.resolveChatSettings(userId, companyId);

    if (!resolvedSettings.config) {
      throw this.buildMissingConfigError(resolvedSettings.can_edit);
    }

    const ragResult = await this.callRagQuery(resolvedSettings.config, content);
    const client = await pool.connect();

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
        config_source: resolvedSettings.config_source,
        collection_name: resolvedSettings.config.collection_name,
        rag_metadatas: ragResult.rag_response.metadatas ?? null
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

      await client.query('COMMIT');

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
        config_source: resolvedSettings.config_source
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
