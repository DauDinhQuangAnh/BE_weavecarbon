const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');

const ANALYTICS_SOURCE = 'server';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_DELIVERY_STATUS = 'pending';
const MAX_LAST_ERROR_LENGTH = 1000;
const OUTBOX_DISPATCH_BATCH_SIZE = 25;

const ANALYTICS_HMAC_SECRET =
  String(
    process.env.ANALYTICS_HMAC_SECRET ||
      process.env.JWT_SECRET ||
      'weavecarbon-analytics'
  ).trim();
const GA4_MEASUREMENT_ID = String(process.env.GA4_MEASUREMENT_ID || '').trim();
const GA4_API_SECRET = String(process.env.GA4_API_SECRET || '').trim();
const GA4_MP_ENDPOINT =
  GA4_MEASUREMENT_ID && GA4_API_SECRET
    ? `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
        GA4_MEASUREMENT_ID
      )}&api_secret=${encodeURIComponent(GA4_API_SECRET)}`
    : '';

const isQueryable = (value) => Boolean(value) && typeof value.query === 'function';

const getQueryable = (value) => (isQueryable(value) ? value : pool);

const normalizeUuid = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const normalizeString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeJsonObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== 'undefined')
  );
};

const truncateErrorMessage = (value) => {
  const message = String(value || '').trim();
  if (!message) return null;
  return message.slice(0, MAX_LAST_ERROR_LENGTH);
};

const normalizeDeliveryStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_DELIVERY_STATUS;
  return normalized;
};

const buildAnalyticsKey = (prefix, rawValue) => {
  const normalizedValue = normalizeUuid(rawValue);
  if (!normalizedValue) {
    return null;
  }

  return `${prefix}_${crypto
    .createHmac('sha256', ANALYTICS_HMAC_SECRET)
    .update(normalizedValue)
    .digest('hex')
    .slice(0, 32)}`;
};

class AnalyticsService {
  buildAnalyticsUserKey(userId) {
    return buildAnalyticsKey('usr', userId);
  }

  buildAnalyticsCompanyKey(companyId) {
    return buildAnalyticsKey('cmp', companyId);
  }

  getAnalyticsIdentity({ userId = null, companyId = null } = {}) {
    return {
      analytics_user_key: this.buildAnalyticsUserKey(userId),
      analytics_company_key: this.buildAnalyticsCompanyKey(companyId)
    };
  }

  async enqueueEvent(queryable, input) {
    const db = getQueryable(queryable);
    const payload = normalizeJsonObject(input.payload_json || input.payload || {});
    const userId = normalizeUuid(input.user_id || input.userId);
    const companyId = normalizeUuid(input.company_id || input.companyId);
    const occurredAt = input.occurred_at || input.occurredAt || new Date();
    const { analytics_user_key, analytics_company_key } = this.getAnalyticsIdentity({
      userId,
      companyId
    });

    const result = await db.query(
      `
        INSERT INTO public.analytics_outbox (
          id,
          event_name,
          occurred_at,
          source,
          user_id,
          company_id,
          analytics_user_key,
          analytics_company_key,
          entity_type,
          entity_id,
          value,
          currency,
          payload_json,
          delivery_status
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14
        )
        RETURNING
          id,
          event_name,
          occurred_at,
          source,
          user_id,
          company_id,
          analytics_user_key,
          analytics_company_key,
          entity_type,
          entity_id,
          value,
          currency,
          payload_json,
          processed_at,
          delivery_status,
          attempt_count,
          last_error
      `,
      [
        uuidv4(),
        normalizeString(input.event_name || input.eventName),
        occurredAt,
        normalizeString(input.source) || ANALYTICS_SOURCE,
        userId,
        companyId,
        analytics_user_key,
        analytics_company_key,
        normalizeString(input.entity_type || input.entityType),
        normalizeString(input.entity_id || input.entityId),
        normalizeNumber(input.value),
        normalizeString(input.currency) || (normalizeNumber(input.value) !== null ? DEFAULT_CURRENCY : null),
        JSON.stringify(payload),
        normalizeDeliveryStatus(input.delivery_status)
      ]
    );

    return result.rows[0];
  }

  buildMeasurementProtocolRequest(eventRow) {
    const payload = normalizeJsonObject(eventRow.payload_json);
    const clientId =
      normalizeString(eventRow.analytics_user_key) ||
      normalizeString(eventRow.analytics_company_key) ||
      `server.${crypto
        .createHash('sha256')
        .update(String(eventRow.id))
        .digest('hex')
        .slice(0, 16)}`;

    return {
      client_id: clientId,
      user_id: normalizeString(eventRow.analytics_user_key) || undefined,
      timestamp_micros: String(new Date(eventRow.occurred_at).getTime() * 1000),
      events: [
        {
          name: String(eventRow.event_name || '').trim(),
          params: {
            ...payload,
            engagement_time_msec: 1,
            source: normalizeString(eventRow.source) || ANALYTICS_SOURCE
          }
        }
      ]
    };
  }

  async markEventDelivery(queryable, eventId, updates) {
    const db = getQueryable(queryable);
    await db.query(
      `
        UPDATE public.analytics_outbox
        SET
          processed_at = COALESCE($2, processed_at),
          delivery_status = COALESCE($3, delivery_status),
          attempt_count = COALESCE($4, attempt_count),
          last_error = $5,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        eventId,
        updates.processed_at || null,
        normalizeString(updates.delivery_status),
        typeof updates.attempt_count === 'number' ? updates.attempt_count : null,
        truncateErrorMessage(updates.last_error)
      ]
    );
  }

  async dispatchOutboxRow(eventRow) {
    if (!GA4_MP_ENDPOINT) {
      await this.markEventDelivery(pool, eventRow.id, {
        processed_at: new Date(),
        delivery_status: 'stored',
        attempt_count: Number(eventRow.attempt_count || 0) + 1,
        last_error: null
      });
      return { id: eventRow.id, status: 'stored' };
    }

    const mpPayload = this.buildMeasurementProtocolRequest(eventRow);

    try {
      await axios.post(GA4_MP_ENDPOINT, mpPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      await this.markEventDelivery(pool, eventRow.id, {
        processed_at: new Date(),
        delivery_status: 'sent',
        attempt_count: Number(eventRow.attempt_count || 0) + 1,
        last_error: null
      });

      return { id: eventRow.id, status: 'sent' };
    } catch (error) {
      await this.markEventDelivery(pool, eventRow.id, {
        delivery_status: 'failed',
        attempt_count: Number(eventRow.attempt_count || 0) + 1,
        last_error: error instanceof Error ? error.message : 'Measurement Protocol dispatch failed'
      });

      throw error;
    }
  }

  async dispatchPendingEvents(eventIds = []) {
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(eventIds) ? eventIds : [])
          .map((value) => normalizeString(value))
          .filter(Boolean)
      )
    );

    if (normalizedIds.length === 0) {
      return [];
    }

    const result = await pool.query(
      `
        SELECT
          id,
          event_name,
          occurred_at,
          source,
          user_id,
          company_id,
          analytics_user_key,
          analytics_company_key,
          entity_type,
          entity_id,
          value,
          currency,
          payload_json,
          processed_at,
          delivery_status,
          attempt_count,
          last_error
        FROM public.analytics_outbox
        WHERE id = ANY($1::uuid[])
      `,
      [normalizedIds]
    );

    const dispatchResults = [];
    for (const row of result.rows) {
      try {
        dispatchResults.push(await this.dispatchOutboxRow(row));
      } catch (error) {
        dispatchResults.push({
          id: row.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Measurement Protocol dispatch failed'
        });
      }
    }

    return dispatchResults;
  }

  async flushPendingEvents(limit = OUTBOX_DISPATCH_BATCH_SIZE) {
    const safeLimit = Math.max(1, Math.min(250, Number(limit) || OUTBOX_DISPATCH_BATCH_SIZE));
    const result = await pool.query(
      `
        SELECT
          id,
          event_name,
          occurred_at,
          source,
          user_id,
          company_id,
          analytics_user_key,
          analytics_company_key,
          entity_type,
          entity_id,
          value,
          currency,
          payload_json,
          processed_at,
          delivery_status,
          attempt_count,
          last_error
        FROM public.analytics_outbox
        WHERE delivery_status IN ('pending', 'failed')
        ORDER BY occurred_at ASC, created_at ASC
        LIMIT $1
      `,
      [safeLimit]
    );

    const outboxIds = result.rows.map((row) => row.id);
    return this.dispatchPendingEvents(outboxIds);
  }

  async trackEvent(input) {
    const row = await this.enqueueEvent(null, input);
    this.queuePendingDispatch([row.id]);
    return row;
  }

  queuePendingDispatch(eventIds = []) {
    void this.dispatchPendingEvents(eventIds).catch((error) => {
      console.error('[analytics] Failed to dispatch pending event:', error);
    });
  }
}

module.exports = new AnalyticsService();
