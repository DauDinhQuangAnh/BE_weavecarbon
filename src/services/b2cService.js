const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const logger = require('../utils/logger');
const { UPLOADS_ROOT } = require('../config/runtime');
const b2cDefaultsService = require('./b2cDefaultsService');
const chatService = require('./chatService');
const {
  DONATION_IMAGE_LEVELS,
  ALLOWED_CATEGORIES,
  ALLOWED_DELIVERY_METHODS,
  MAX_GPS_DISTANCE_KM,
  IMAGE_ANALYSIS_ITEM_KEYWORDS,
  toNumber,
  roundTo,
  computeDonationCo2Saved,
  ALLOWED_DISPOSITIONS,
  dispositionCo2Saved,
  normalizeOptionalString,
  calculateDistanceKm,
  resolveLevel,
  createBusinessError,
  deleteUploadedFile,
  mapMaterialReward,
  resolveAnalysisMaterial,
  inferAnalysisItems,
  mapRagGarmentItemsToProducts,
  mapCoupon,
  mapCollectionPointSummary,
  mapDonationSummary
} = require('./b2cService/helpers');

let schemaReadyPromise = null;


class B2CService {
  async ensureSchema(client) {
    if (client) {
      await this._applySchema(client);
      await b2cDefaultsService.ensureSeedData(client);
      return;
    }

    if (!schemaReadyPromise) {
      schemaReadyPromise = (async () => {
        const schemaClient = await pool.connect();
        try {
          await this._applySchema(schemaClient);
          await b2cDefaultsService.ensureSeedData(schemaClient);
        } finally {
          schemaClient.release();
        }
      })().catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
    }

    await schemaReadyPromise;
  }

  async _applySchema(client) {
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS source_image_storage_key TEXT
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS source_image_original_name TEXT
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS source_image_mime_type TEXT
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS source_image_size_bytes INTEGER
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS disposition TEXT
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS disposition_note TEXT
    `);
    await client.query(`
      ALTER TABLE public.donations
      ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ
    `);
  }

  async getDashboard(userId) {
    await this.ensureSchema();
    const client = await pool.connect();

    try {
      const profileResult = await client.query(
        `
          SELECT
            u.id,
            u.email,
            u.full_name,
            u.avatar_url,
            COALESCE(ur.total_points, 0) AS total_points,
            COALESCE(ur.total_donations, 0) AS total_donations,
            COALESCE(ur.total_items_donated, 0) AS total_items_donated,
            COALESCE(ur.total_weight_kg, 0) AS total_weight_kg,
            COALESCE(ur.total_co2_saved, 0) AS total_co2_saved,
            COALESCE(ur.current_level, 'Beginner') AS current_level
          FROM public.users u
          LEFT JOIN public.user_rewards ur ON ur.user_id = u.id
          WHERE u.id = $1
        `,
        [userId]
      );

      if (profileResult.rows.length === 0) {
        throw createBusinessError('USER_NOT_FOUND', 'User not found', 404);
      }

      const activityResult = await client.query(
        `
          SELECT
            rt.id,
            rt.donation_id,
            rt.transaction_type,
            rt.points,
            rt.description,
            rt.created_at,
            d.category,
            d.status,
            COALESCE(di.item_count, 0) AS item_count,
            di.first_item_name
          FROM public.reward_transactions rt
          LEFT JOIN public.donations d ON d.id = rt.donation_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS item_count,
              MIN(item_name) AS first_item_name
            FROM public.donation_items di
            WHERE di.donation_id = rt.donation_id
          ) di ON TRUE
          WHERE rt.user_id = $1
          ORDER BY rt.created_at DESC
          LIMIT 8
        `,
        [userId]
      );

      const donationResult = await client.query(
        `
          SELECT
            d.id,
            d.category,
            d.delivery_method,
            d.status,
            d.item_description,
            d.base_points,
            d.bonus_points,
            d.total_points,
            d.co2_saved,
            d.disposition,
            d.disposition_note,
            d.disposition_at,
            d.shipping_tracking_number,
            d.confirmation_method,
            d.created_at,
            d.confirmed_at,
            d.completed_at,
            d.source_image_storage_key,
            d.source_image_original_name,
            d.source_image_mime_type,
            d.source_image_size_bytes,
            cp.id AS collection_point_id,
            cp.name AS collection_point_name,
            cp.address AS collection_point_address,
            cp.city AS collection_point_city,
            cp.district AS collection_point_district,
            COALESCE(di.item_count, 0) AS total_items,
            COALESCE(di.total_weight_kg, d.estimated_weight_kg, d.actual_weight_kg, 0) AS total_weight_kg
          FROM public.donations d
          LEFT JOIN public.collection_points cp ON cp.id = d.collection_point_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS item_count,
              COALESCE(SUM(weight_kg), 0) AS total_weight_kg
            FROM public.donation_items di
            WHERE di.donation_id = d.id
          ) di ON TRUE
          WHERE d.user_id = $1
          ORDER BY d.created_at DESC
          LIMIT 5
        `,
        [userId]
      );

      const row = profileResult.rows[0];
      const totalPoints = Math.max(0, Math.trunc(toNumber(row.total_points)));
      const totalCo2Saved = roundTo(toNumber(row.total_co2_saved));

      return {
        profile: {
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          avatar_url: row.avatar_url
        },
        rewards_summary: {
          total_points: totalPoints,
          total_donations: Math.max(0, Math.trunc(toNumber(row.total_donations))),
          total_items_donated: Math.max(0, Math.trunc(toNumber(row.total_items_donated))),
          total_weight_kg: roundTo(toNumber(row.total_weight_kg)),
          total_co2_saved: totalCo2Saved,
          current_level: row.current_level || resolveLevel(totalPoints),
          trees_equivalent: Math.max(0, Math.round(totalCo2Saved / 21))
        },
        recent_activity: activityResult.rows.map((activity) => {
          const itemCount = Math.max(0, Math.trunc(toNumber(activity.item_count)));
          const firstItemName = normalizeOptionalString(activity.first_item_name);
          const itemLabel =
            itemCount <= 1
              ? firstItemName || activity.description || 'Donation'
              : `${firstItemName || 'Donation'} +${itemCount - 1}`;

          return {
            id: activity.id,
            donation_id: activity.donation_id,
            transaction_type: activity.transaction_type,
            type: activity.category || 'recycle',
            title: activity.description || 'Donation activity',
            item_label: itemLabel,
            item_count: itemCount,
            points: Math.max(0, Math.trunc(toNumber(activity.points))),
            status: activity.status,
            created_at: activity.created_at
          };
        }),
        recent_donations: donationResult.rows.map(mapDonationSummary)
      };
    } finally {
      client.release();
    }
  }

  async listMaterialRewards() {
    await this.ensureSchema();

    const result = await pool.query(`
      SELECT
        id,
        material_name,
        material_category,
        points_per_kg,
        co2_saved_per_kg,
        description,
        is_active
      FROM public.material_rewards
      WHERE is_active = TRUE
      ORDER BY material_name ASC
    `);

    return {
      items: result.rows.map(mapMaterialReward)
    };
  }

  async analyzeDonationImage(file, category = 'recycle') {
    await this.ensureSchema();

    if (!file) {
      throw createBusinessError(
        'DONATION_IMAGE_REQUIRED',
        'Donation image is required for analysis',
        422
      );
    }

    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      throw createBusinessError(
        'INVALID_DONATION_IMAGE',
        'Only image files can be analyzed',
        400
      );
    }

    const normalizedCategory = ALLOWED_CATEGORIES.has(category) ? category : 'recycle';
    const materialsPayload = await this.listMaterialRewards();
    const materials = materialsPayload.items.filter((material) => material.is_active);

    // Prefer real Gemini vision via the RAG /extract endpoint; fall back to the
    // filename heuristic so the camera flow never breaks when the AI service is
    // unavailable or unconfigured.
    let products = [];
    let provider = 'heuristic';

    if (file.buffer && file.buffer.length > 0) {
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
          file.originalname || 'garment.jpg'
        );
        form.append('kind', 'garment');
        form.append('language', 'vi');

        const result = await chatService.callGlobalRagEndpoint('/extract', {
          method: 'POST',
          data: form
        });

        const items = Array.isArray(result?.fields?.items)
          ? result.fields.items
          : Array.isArray(result?.items)
            ? result.items
            : [];
        const mapped = mapRagGarmentItemsToProducts(items, materials, normalizedCategory);

        if (mapped.length > 0) {
          products = mapped;
          provider = 'rag-vision';
        } else {
          logger.warn(
            { fileName: file.originalname },
            '[b2c] RAG vision returned no garment items, falling back to heuristic'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, code: error?.code, fileName: file.originalname },
          '[b2c] RAG vision analysis failed, falling back to heuristic'
        );
      }
    }

    if (products.length === 0) {
      const inferredItems = inferAnalysisItems(file.originalname, normalizedCategory);
      products = inferredItems.map((item) => {
        const material = resolveAnalysisMaterial(materials, item.materialHint);

        return {
          item_name: item.itemName,
          item_type: item.itemType,
          material_id: material?.id || 'other',
          custom_material_name: material ? undefined : 'Other Material',
          condition: normalizedCategory === 'charity' ? 'good' : 'fair',
          weight_kg: item.weightKg,
          confidence: 0.62
        };
      });
    }

    const ragProvider = provider === 'rag-vision';

    return {
      products,
      total_items_detected: products.length,
      overall_confidence: ragProvider ? 0.8 : products.length > 1 ? 0.66 : 0.62,
      raw_analysis: {
        provider,
        file_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        category: normalizedCategory
      }
    };
  }

  async listCoupons({ search, category, status = 'active', limit = 48 } = {}) {
    await this.ensureSchema();

    const normalizedSearch = normalizeOptionalString(search);
    const normalizedCategory = normalizeOptionalString(category);
    const shouldFilterActive = status !== 'all';
    const safeLimit = Math.min(Math.max(Number(limit) || 48, 1), 100);
    const searchPattern = normalizedSearch ? `%${normalizedSearch}%` : null;

    const result = await pool.query(
      `
        SELECT
          c.id,
          c.title,
          c.merchant_name,
          c.category,
          c.description,
          c.points_cost,
          c.discount_type,
          c.discount_value,
          c.currency,
          c.code,
          c.image_url,
          c.valid_from,
          c.valid_until,
          c.stock_total,
          c.stock_remaining,
          c.redemption_limit_per_user,
          c.redemption_method,
          c.terms,
          c.tags,
          c.is_featured,
          c.is_active,
          c.created_at,
          c.updated_at,
          COUNT(*) OVER() AS total_count
        FROM public.b2c_coupons c
        WHERE
          ($1::text IS NULL OR LOWER(c.category) = LOWER($1))
          AND (
            $2::text IS NULL
            OR c.title ILIKE $2
            OR c.merchant_name ILIKE $2
            OR COALESCE(c.description, '') ILIKE $2
            OR EXISTS (
              SELECT 1
              FROM unnest(COALESCE(c.tags, '{}'::text[])) AS tag
              WHERE tag ILIKE $2
            )
          )
          AND (
            NOT $3::boolean
            OR (
              c.is_active = TRUE
              AND (c.valid_from IS NULL OR c.valid_from <= NOW())
              AND (c.valid_until IS NULL OR c.valid_until >= NOW())
            )
          )
        ORDER BY
          c.is_featured DESC,
          c.sort_order ASC,
          c.points_cost ASC,
          c.valid_until ASC NULLS LAST
        LIMIT $4
      `,
      [normalizedCategory, searchPattern, shouldFilterActive, safeLimit]
    );

    const totalCount = result.rows.length > 0 ? Math.max(0, Math.trunc(toNumber(result.rows[0].total_count))) : 0;

    return {
      items: result.rows.map(mapCoupon),
      total_count: totalCount
    };
  }

  async listDonations(userId, { limit = 20 } = {}) {
    await this.ensureSchema();

    const result = await pool.query(
      `
        SELECT
          d.id,
          d.category,
          d.delivery_method,
          d.status,
          d.item_description,
          d.base_points,
          d.bonus_points,
          d.total_points,
          d.co2_saved,
          d.disposition,
          d.disposition_note,
          d.disposition_at,
          d.shipping_tracking_number,
          d.confirmation_method,
          d.created_at,
          d.confirmed_at,
          d.completed_at,
          d.source_image_storage_key,
          d.source_image_original_name,
          d.source_image_mime_type,
          d.source_image_size_bytes,
          cp.id AS collection_point_id,
          cp.name AS collection_point_name,
          cp.address AS collection_point_address,
          cp.city AS collection_point_city,
          cp.district AS collection_point_district,
          COALESCE(di.item_count, 0) AS total_items,
          COALESCE(di.total_weight_kg, d.estimated_weight_kg, d.actual_weight_kg, 0) AS total_weight_kg
        FROM public.donations d
        LEFT JOIN public.collection_points cp ON cp.id = d.collection_point_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS item_count,
            COALESCE(SUM(weight_kg), 0) AS total_weight_kg
          FROM public.donation_items di
          WHERE di.donation_id = d.id
        ) di ON TRUE
        WHERE d.user_id = $1
        ORDER BY d.created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    return {
      items: result.rows.map(mapDonationSummary)
    };
  }

  async getDonationById(userId, donationId) {
    await this.ensureSchema();
    const client = await pool.connect();

    try {
      return await this._getDonationDetail(client, userId, donationId);
    } finally {
      client.release();
    }
  }

  async _getDonationDetail(client, userId, donationId) {
    const donationResult = await client.query(
      `
        SELECT
          d.id,
          d.user_id,
          d.category,
          d.delivery_method,
          d.status,
          d.item_description,
          d.base_points,
          d.bonus_points,
          d.total_points,
          d.co2_saved,
          d.disposition,
          d.disposition_note,
          d.disposition_at,
          d.shipping_tracking_number,
          d.confirmation_method,
          d.created_at,
          d.confirmed_at,
          d.completed_at,
          d.source_image_storage_key,
          d.source_image_original_name,
          d.source_image_mime_type,
          d.source_image_size_bytes,
          cp.id AS collection_point_id,
          cp.name AS collection_point_name,
          cp.address AS collection_point_address,
          cp.city AS collection_point_city,
          cp.district AS collection_point_district,
          COALESCE(di.item_count, 0) AS total_items,
          COALESCE(di.total_weight_kg, d.estimated_weight_kg, d.actual_weight_kg, 0) AS total_weight_kg
        FROM public.donations d
        LEFT JOIN public.collection_points cp ON cp.id = d.collection_point_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS item_count,
            COALESCE(SUM(weight_kg), 0) AS total_weight_kg
          FROM public.donation_items di
          WHERE di.donation_id = d.id
        ) di ON TRUE
        WHERE d.id = $1 AND d.user_id = $2
        LIMIT 1
      `,
      [donationId, userId]
    );

    if (donationResult.rows.length === 0) {
      throw createBusinessError('DONATION_NOT_FOUND', 'Donation not found', 404);
    }

    const itemsResult = await client.query(
      `
        SELECT
          di.id,
          di.item_name,
          di.item_type,
          di.condition,
          di.material_id,
          mr.material_name,
          mr.material_category,
          di.weight_kg,
          di.points_earned,
          di.co2_saved,
          di.created_at
        FROM public.donation_items di
        LEFT JOIN public.material_rewards mr ON mr.id = di.material_id
        WHERE di.donation_id = $1
        ORDER BY di.created_at ASC, di.id ASC
      `,
      [donationId]
    );

    return {
      ...mapDonationSummary(donationResult.rows[0]),
      items: itemsResult.rows.map((row) => ({
        id: row.id,
        item_name: row.item_name,
        item_type: row.item_type,
        condition: row.condition,
        material_id: row.material_id,
        material_name: row.material_name,
        material_category: row.material_category,
        weight_kg: roundTo(toNumber(row.weight_kg)),
        points_earned: Math.max(0, Math.trunc(toNumber(row.points_earned))),
        co2_saved: roundTo(toNumber(row.co2_saved)),
        created_at: row.created_at
      }))
    };
  }

  // Sorting-centre action: record the actual end-of-life disposition of a
  // donation, recompute its CO₂ saving from the real pathway, and delta-adjust
  // the donor's running total. Restricted to operators/admins at the route layer.
  async recordDonationDisposition(donationId, disposition, note) {
    await this.ensureSchema();

    const normalizedDisposition = normalizeOptionalString(disposition);
    if (!normalizedDisposition || !ALLOWED_DISPOSITIONS.has(normalizedDisposition)) {
      throw createBusinessError(
        'INVALID_DISPOSITION',
        'Disposition must be one of: reuse, recycle, waste',
        422
      );
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const donationResult = await client.query(
        `
          SELECT id, user_id, co2_saved
          FROM public.donations
          WHERE id = $1
          FOR UPDATE
        `,
        [donationId]
      );

      if (donationResult.rows.length === 0) {
        throw createBusinessError('DONATION_NOT_FOUND', 'Donation not found', 404);
      }

      const donation = donationResult.rows[0];
      const previousCo2 = roundTo(toNumber(donation.co2_saved));

      const itemsResult = await client.query(
        `
          SELECT
            di.id,
            di.weight_kg,
            di.co2_saved,
            COALESCE(mr.co2_saved_per_kg, 0) AS co2_saved_per_kg
          FROM public.donation_items di
          LEFT JOIN public.material_rewards mr ON mr.id = di.material_id
          WHERE di.donation_id = $1
        `,
        [donationId]
      );

      let newTotalCo2 = 0;
      for (const item of itemsResult.rows) {
        const itemCo2 = roundTo(
          dispositionCo2Saved(
            normalizedDisposition,
            item.co2_saved_per_kg,
            item.weight_kg
          )
        );
        newTotalCo2 += itemCo2;

        await client.query(
          `
            UPDATE public.donation_items
            SET co2_saved = $1
            WHERE id = $2
          `,
          [itemCo2, item.id]
        );
      }

      newTotalCo2 = roundTo(newTotalCo2);
      const delta = roundTo(newTotalCo2 - previousCo2);

      await client.query(
        `
          UPDATE public.donations
          SET
            disposition = $1,
            disposition_note = $2,
            disposition_at = NOW(),
            co2_saved = $3,
            status = 'completed',
            completed_at = COALESCE(completed_at, NOW()),
            updated_at = NOW()
          WHERE id = $4
        `,
        [normalizedDisposition, normalizeOptionalString(note), newTotalCo2, donationId]
      );

      await client.query(
        `
          UPDATE public.user_rewards
          SET
            total_co2_saved = GREATEST(0, total_co2_saved + $1),
            updated_at = NOW()
          WHERE user_id = $2
        `,
        [delta, donation.user_id]
      );

      const detail = await this._getDonationDetail(client, donation.user_id, donationId);

      await client.query('COMMIT');
      return { ...detail, co2_delta: delta };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRewardTransactions(userId, { limit = 30 } = {}) {
    await this.ensureSchema();

    const result = await pool.query(
      `
        SELECT
          rt.id,
          rt.donation_id,
          rt.transaction_type,
          rt.points,
          rt.description,
          rt.created_at
        FROM public.reward_transactions rt
        WHERE rt.user_id = $1
        ORDER BY rt.created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        donation_id: row.donation_id,
        transaction_type: row.transaction_type,
        points: Math.max(0, Math.trunc(toNumber(row.points))),
        description: row.description,
        created_at: row.created_at
      }))
    };
  }

  async getDonationImage(userId, donationId) {
    await this.ensureSchema();

    const result = await pool.query(
      `
        SELECT
          source_image_storage_key,
          source_image_original_name,
          source_image_mime_type,
          source_image_size_bytes
        FROM public.donations
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [donationId, userId]
    );

    if (result.rows.length === 0) {
      throw createBusinessError('DONATION_NOT_FOUND', 'Donation not found', 404);
    }

    const row = result.rows[0];
    if (!row.source_image_storage_key) {
      throw createBusinessError('DONATION_IMAGE_NOT_FOUND', 'Donation image not found', 404);
    }

    const resolvedPath = path.resolve(UPLOADS_ROOT, row.source_image_storage_key);
    if (!resolvedPath.startsWith(UPLOADS_ROOT)) {
      throw createBusinessError('INVALID_STORAGE_PATH', 'Invalid donation image path', 400);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw createBusinessError('DONATION_IMAGE_FILE_MISSING', 'Donation image file is missing', 404);
    }

    return {
      filePath: resolvedPath,
      originalName: row.source_image_original_name || 'donation-image',
      mimeType: row.source_image_mime_type || 'application/octet-stream',
      sizeBytes: Math.max(0, Math.trunc(toNumber(row.source_image_size_bytes)))
    };
  }

  async createDonation(userId, payload, uploadedFile) {
    if (!payload || typeof payload !== 'object') {
      throw createBusinessError('INVALID_DONATION_PAYLOAD', 'Donation payload is required', 422);
    }

    if (!uploadedFile?.path) {
      throw createBusinessError('SOURCE_IMAGE_REQUIRED', 'Donation image is required', 400);
    }

    const category = normalizeOptionalString(payload.category);
    if (!category || !ALLOWED_CATEGORIES.has(category)) {
      throw createBusinessError('INVALID_DONATION_CATEGORY', 'Donation category is invalid', 422);
    }

    const deliveryMethod = normalizeOptionalString(payload.delivery_method);
    if (!deliveryMethod || !ALLOWED_DELIVERY_METHODS.has(deliveryMethod)) {
      throw createBusinessError(
        'INVALID_DELIVERY_METHOD',
        'Delivery method must be drop_off or shipping',
        422
      );
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      throw createBusinessError('DONATION_ITEMS_REQUIRED', 'At least one donation item is required', 422);
    }

    const normalizedItems = items.map((item, index) => {
      const itemName = normalizeOptionalString(item.item_name);
      const materialId = normalizeOptionalString(item.material_id);
      const weightKg = toNumber(item.weight_kg, Number.NaN);

      if (!itemName) {
        throw createBusinessError(
          'INVALID_DONATION_ITEM',
          `Donation item #${index + 1} is missing a name`,
          422
        );
      }

      if (!materialId) {
        throw createBusinessError(
          'INVALID_DONATION_ITEM',
          `Donation item #${index + 1} is missing material`,
          422
        );
      }

      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        throw createBusinessError(
          'INVALID_DONATION_ITEM',
          `Donation item #${index + 1} must have a positive weight`,
          422
        );
      }

      return {
        item_name: itemName,
        item_type: normalizeOptionalString(item.item_type),
        condition: normalizeOptionalString(item.condition),
        material_id: materialId,
        weight_kg: roundTo(weightKg)
      };
    });

    const collectionPointId = normalizeOptionalString(payload.collection_point_id);
    const shippingTrackingNumber = normalizeOptionalString(payload.shipping_tracking_number);
    const gpsCheckin =
      payload.gps_checkin && typeof payload.gps_checkin === 'object'
        ? {
            latitude: toNumber(payload.gps_checkin.latitude, Number.NaN),
            longitude: toNumber(payload.gps_checkin.longitude, Number.NaN),
            checked_at: normalizeOptionalString(payload.gps_checkin.checked_at)
          }
        : null;

    if (deliveryMethod === 'drop_off') {
      if (!collectionPointId) {
        throw createBusinessError(
          'COLLECTION_POINT_REQUIRED',
          'Collection point is required for drop-off donations',
          422
        );
      }

      if (
        gpsCheckin &&
        (!Number.isFinite(gpsCheckin.latitude) || !Number.isFinite(gpsCheckin.longitude))
      ) {
        throw createBusinessError(
          'INVALID_GPS_CHECKIN',
          'GPS check-in must include a valid latitude and longitude',
          422
        );
      }
    }

    const client = await pool.connect();

    try {
      await this.ensureSchema(client);
      await client.query('BEGIN');

      const materialIds = [...new Set(normalizedItems.map((item) => item.material_id))];
      const materialsResult = await client.query(
        `
          SELECT
            id,
            material_name,
            material_category,
            points_per_kg,
            co2_saved_per_kg,
            is_active
          FROM public.material_rewards
          WHERE id = ANY($1::uuid[])
        `,
        [materialIds]
      );

      const materialMap = new Map(
        materialsResult.rows.map((row) => [row.id, mapMaterialReward(row)])
      );

      if (materialMap.size !== materialIds.length) {
        throw createBusinessError(
          'MATERIAL_NOT_FOUND',
          'One or more selected materials are not available',
          422
        );
      }

      let collectionPointRow = null;
      let donationStatus = 'pending';
      let confirmedAt = null;
      let confirmationMethod = null;
      let actualWeightKg = null;

      if (deliveryMethod === 'drop_off') {
        const collectionPointResult = await client.query(
          `
            SELECT
              id,
              name,
              address,
              city,
              district,
              latitude::double precision AS latitude,
              longitude::double precision AS longitude,
              is_active
            FROM public.collection_points
            WHERE id = $1
            LIMIT 1
          `,
          [collectionPointId]
        );

        if (collectionPointResult.rows.length === 0 || collectionPointResult.rows[0].is_active !== true) {
          throw createBusinessError(
            'COLLECTION_POINT_NOT_FOUND',
            'Selected collection point is not available',
            404
          );
        }

        collectionPointRow = collectionPointResult.rows[0];
        const pointLatitude = toNumber(collectionPointRow.latitude, Number.NaN);
        const pointLongitude = toNumber(collectionPointRow.longitude, Number.NaN);

        if (!Number.isFinite(pointLatitude) || !Number.isFinite(pointLongitude)) {
          throw createBusinessError(
            'COLLECTION_POINT_LOCATION_MISSING',
            'Selected collection point does not have a valid location',
            422
          );
        }

        if (gpsCheckin) {
          const distanceKm = calculateDistanceKm(
            gpsCheckin.latitude,
            gpsCheckin.longitude,
            pointLatitude,
            pointLongitude
          );

          if (distanceKm <= MAX_GPS_DISTANCE_KM) {
            donationStatus = 'received';
            confirmedAt = gpsCheckin.checked_at ? new Date(gpsCheckin.checked_at) : new Date();
            confirmationMethod = 'gps';
          }
        }
      } else if (shippingTrackingNumber) {
        donationStatus = 'in_transit';
      }

      const computedItems = normalizedItems.map((item) => {
        const material = materialMap.get(item.material_id);
        const basePoints = Math.round(material.points_per_kg * item.weight_kg);
        const co2Saved = roundTo(
          computeDonationCo2Saved(category, material.co2_saved_per_kg, item.weight_kg)
        );

        return {
          ...item,
          material,
          points_earned: basePoints,
          co2_saved: co2Saved
        };
      });

      const totalWeightKg = roundTo(
        computedItems.reduce((sum, item) => sum + item.weight_kg, 0)
      );
      const basePoints = computedItems.reduce((sum, item) => sum + item.points_earned, 0);
      const bonusPoints =
        category === 'charity' ? Math.round(basePoints * 0.5) : 0;
      const totalPoints = basePoints + bonusPoints;
      const co2Saved = roundTo(
        computedItems.reduce((sum, item) => sum + item.co2_saved, 0)
      );
      actualWeightKg = donationStatus === 'received' ? totalWeightKg : null;

      const sourceImageStorageKey = path
        .relative(UPLOADS_ROOT, uploadedFile.path)
        .replace(/\\/g, '/');

      const donationInsertResult = await client.query(
        `
          INSERT INTO public.donations (
            user_id,
            category,
            delivery_method,
            status,
            item_description,
            material_id,
            estimated_weight_kg,
            actual_weight_kg,
            collection_point_id,
            shipping_tracking_number,
            base_points,
            bonus_points,
            total_points,
            co2_saved,
            confirmed_at,
            confirmation_method,
            source_image_storage_key,
            source_image_original_name,
            source_image_mime_type,
            source_image_size_bytes,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
          )
          RETURNING id
        `,
        [
          userId,
          category,
          deliveryMethod,
          donationStatus,
          `${computedItems.length} item(s): ${computedItems.map((item) => item.item_name).join(', ')}`,
          computedItems.length === 1 ? computedItems[0].material_id : null,
          totalWeightKg,
          actualWeightKg,
          collectionPointId,
          shippingTrackingNumber,
          basePoints,
          bonusPoints,
          totalPoints,
          co2Saved,
          confirmedAt,
          confirmationMethod,
          sourceImageStorageKey,
          uploadedFile.originalname || 'donation-image',
          uploadedFile.mimetype || 'application/octet-stream',
          uploadedFile.size || 0
        ]
      );

      const donationId = donationInsertResult.rows[0].id;

      for (const item of computedItems) {
        await client.query(
          `
            INSERT INTO public.donation_items (
              donation_id,
              item_name,
              item_type,
              condition,
              material_id,
              weight_kg,
              points_earned,
              co2_saved,
              created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, NOW()
            )
          `,
          [
            donationId,
            item.item_name,
            item.item_type,
            item.condition,
            item.material_id,
            item.weight_kg,
            item.points_earned,
            item.co2_saved
          ]
        );
      }

      const nextLevel = resolveLevel(totalPoints);
      await client.query(
        `
          INSERT INTO public.user_rewards (
            user_id,
            total_points,
            total_donations,
            total_items_donated,
            total_weight_kg,
            total_co2_saved,
            current_level,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, 1, $3, $4, $5, $6, NOW(), NOW()
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            total_points = public.user_rewards.total_points + EXCLUDED.total_points,
            total_donations = public.user_rewards.total_donations + 1,
            total_items_donated = public.user_rewards.total_items_donated + EXCLUDED.total_items_donated,
            total_weight_kg = public.user_rewards.total_weight_kg + EXCLUDED.total_weight_kg,
            total_co2_saved = public.user_rewards.total_co2_saved + EXCLUDED.total_co2_saved,
            current_level = CASE
              WHEN public.user_rewards.total_points + EXCLUDED.total_points >= 2000 THEN 'Champion'
              WHEN public.user_rewards.total_points + EXCLUDED.total_points >= 1000 THEN 'Advocate'
              WHEN public.user_rewards.total_points + EXCLUDED.total_points >= 400 THEN 'Explorer'
              ELSE 'Beginner'
            END,
            updated_at = NOW()
        `,
        [
          userId,
          totalPoints,
          computedItems.length,
          totalWeightKg,
          co2Saved,
          nextLevel
        ]
      );

      await client.query(
        `
          INSERT INTO public.reward_transactions (
            user_id,
            donation_id,
            transaction_type,
            points,
            description,
            created_at
          ) VALUES (
            $1, $2, 'earn', $3, $4, NOW()
          )
        `,
        [
          userId,
          donationId,
          totalPoints,
          `Donation ${category === 'charity' ? 'for charity' : 'for recycling'}: ${computedItems.length} item(s)`
        ]
      );

      const donationDetail = await this._getDonationDetail(client, userId, donationId);

      await client.query('COMMIT');
      return donationDetail;
    } catch (error) {
      await client.query('ROLLBACK');
      deleteUploadedFile(uploadedFile?.path);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new B2CService();
module.exports.createBusinessError = createBusinessError;
