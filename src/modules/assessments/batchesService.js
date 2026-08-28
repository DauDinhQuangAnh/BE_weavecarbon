/**
 * Batches Service
 * Business logic for product batch management
 */

const pool = require('../shared/database');
const domesticComplianceService = require('../shared/domesticCompliance');

const DEFAULT_EMISSION_FACTOR_BY_MODE = {
  road: 0.12226,
  sea: 0.01612,
  air: 0.89939,
  rail: 0.02779
};

const TRANSPORT_MODE_ALIASES = {
  road: 'road',
  truck: 'road',
  truck_light: 'road',
  truck_heavy: 'road',
  sea: 'sea',
  ship: 'sea',
  ocean: 'sea',
  air: 'air',
  flight: 'air',
  rail: 'rail',
  train: 'rail'
};

class BatchesService {
  constructor({ database = pool, complianceService = domesticComplianceService } = {}) {
    this.database = database;
    this.complianceService = complianceService;
  }

  /**
   * List batches for a company
   */
  async listBatches(companyId, filters = {}) {
    const {
      search = '',
      status = 'all',
      page = 1,
      page_size = 20
    } = filters;

    const offset = (page - 1) * page_size;
    const params = [companyId];
    let paramIndex = 2;

    // Build WHERE clause
    let whereClause = 'WHERE pb.company_id = $1';

    if (status !== 'all') {
      whereClause += ` AND pb.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (pb.batch_name ILIKE $${paramIndex} OR pb.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM product_batches pb
      ${whereClause}
    `;
    const countResult = await this.database.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch batches
    const query = `
      SELECT
        pb.id,
        pb.batch_name as name,
        pb.description,
        pb.status,
        pb.origin_address,
        pb.destination_address,
        pb.destination_market,
        pb.transport_modes,
        pb.shipment_id,
        pb.total_products,
        pb.total_quantity,
        pb.total_weight_kg,
        pb.total_co2e,
        pb.published_at,
        pb.created_at,
        pb.updated_at
      FROM product_batches pb
      ${whereClause}
      ORDER BY pb.updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(page_size, offset);

    const result = await this.database.query(query, params);

    const items = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      originAddress: row.origin_address,
      destinationAddress: row.destination_address,
      destinationMarket: row.destination_market,
      transportModes: row.transport_modes || [],
      shipmentId: row.shipment_id,
      totalProducts: row.total_products,
      totalQuantity: parseFloat(row.total_quantity || 0),
      totalWeight: parseFloat(row.total_weight_kg || 0),
      totalCO2: parseFloat(row.total_co2e || 0),
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return {
      items,
      pagination: {
        page,
        page_size,
        total,
        total_pages: Math.ceil(total / page_size)
      }
    };
  }

  /**
   * Get batch by ID with items
   */
  async getBatchById(batchId, companyId) {
    // Get batch
    const batchQuery = `
      SELECT
        pb.id,
        pb.batch_name as name,
        pb.description,
        pb.status,
        pb.origin_address,
        pb.destination_address,
        pb.destination_market,
        pb.transport_modes,
        pb.shipment_id,
        pb.total_products,
        pb.total_quantity,
        pb.total_weight_kg,
        pb.total_co2e,
        pb.published_at,
        pb.created_at,
        pb.updated_at
      FROM product_batches pb
      WHERE pb.id = $1 AND pb.company_id = $2
    `;
    const batchResult = await this.database.query(batchQuery, [batchId, companyId]);

    if (batchResult.rows.length === 0) {
      return null;
    }

    const batch = batchResult.rows[0];

    // Get items
    const itemsQuery = `
      SELECT
        pbi.id,
        pbi.product_id,
        pbi.quantity,
        pbi.weight_kg,
        pbi.co2_per_unit,
        p.sku as product_code,
        p.name as product_name,
        p.category as product_type,
        p.total_co2e
      FROM product_batch_items pbi
      JOIN products p ON p.id = pbi.product_id
      WHERE pbi.batch_id = $1
      ORDER BY pbi.created_at ASC
    `;
    const itemsResult = await this.database.query(itemsQuery, [batchId]);

    return {
      id: batch.id,
      name: batch.name,
      description: batch.description,
      status: batch.status,
      originAddress: batch.origin_address,
      destinationAddress: batch.destination_address,
      destinationMarket: batch.destination_market,
      transportModes: batch.transport_modes || [],
      shipmentId: batch.shipment_id,
      totalProducts: batch.total_products,
      totalQuantity: parseFloat(batch.total_quantity || 0),
      totalWeight: parseFloat(batch.total_weight_kg || 0),
      totalCO2: parseFloat(batch.total_co2e || 0),
      publishedAt: batch.published_at,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      items: itemsResult.rows.map(item => ({
        id: item.id,
        productId: item.product_id,
        productCode: item.product_code,
        productName: item.product_name,
        productType: item.product_type,
        quantity: parseFloat(item.quantity),
        weightKg: parseFloat(item.weight_kg || 0),
        co2PerUnit: parseFloat(item.co2_per_unit || item.total_co2e || 0)
      }))
    };
  }

  /**
   * Create new batch
   */
  async createBatch(companyId, userId, batchData) {
    const {
      name,
      description = null,
      originAddress = null,
      destinationAddress = null,
      destinationMarket = null,
      transportModes = []
    } = batchData;

    const query = `
      INSERT INTO product_batches (
        company_id,
        batch_name,
        description,
        origin_address,
        destination_address,
        destination_market,
        transport_modes,
        created_by,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
      RETURNING id, status, created_at, updated_at
    `;

    const result = await this.database.query(query, [
      companyId,
      name,
      description,
      originAddress ? JSON.stringify(originAddress) : null,
      destinationAddress ? JSON.stringify(destinationAddress) : null,
      destinationMarket,
      transportModes,
      userId
    ]);

    return {
      id: result.rows[0].id,
      status: result.rows[0].status,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    };
  }

  /**
   * Update batch metadata
   */
  async updateBatch(batchId, companyId, updateData) {
    // Check batch exists
    const checkQuery = 'SELECT id, status FROM product_batches WHERE id = $1 AND company_id = $2';
    const checkResult = await this.database.query(checkQuery, [batchId, companyId]);

    if (checkResult.rows.length === 0) {
      return null;
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (updateData.name !== undefined) {
      updates.push(`batch_name = $${paramIndex}`);
      params.push(updateData.name);
      paramIndex++;
    }

    if (updateData.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(updateData.description);
      paramIndex++;
    }

    if (updateData.originAddress !== undefined) {
      updates.push(`origin_address = $${paramIndex}`);
      params.push(updateData.originAddress ? JSON.stringify(updateData.originAddress) : null);
      paramIndex++;
    }

    if (updateData.destinationAddress !== undefined) {
      updates.push(`destination_address = $${paramIndex}`);
      params.push(updateData.destinationAddress ? JSON.stringify(updateData.destinationAddress) : null);
      paramIndex++;
    }

    if (updateData.destinationMarket !== undefined) {
      updates.push(`destination_market = $${paramIndex}`);
      params.push(updateData.destinationMarket);
      paramIndex++;
    }

    if (updateData.transportModes !== undefined) {
      updates.push(`transport_modes = $${paramIndex}`);
      params.push(updateData.transportModes);
      paramIndex++;
    }

    if (updates.length === 0) {
      return {
        id: batchId,
        status: checkResult.rows[0].status,
        updatedAt: new Date()
      };
    }

    updates.push(`updated_at = now()`);
    params.push(batchId, companyId);

    const query = `
      UPDATE product_batches
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
      RETURNING id, status, updated_at
    `;

    const result = await this.database.query(query, params);

    return {
      id: result.rows[0].id,
      status: result.rows[0].status,
      updatedAt: result.rows[0].updated_at
    };
  }

  /**
   * Delete batch (soft delete to archived)
   */
  async deleteBatch(batchId, companyId) {
    const query = `
      UPDATE product_batches
      SET status = 'archived', updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING id
    `;

    const result = await this.database.query(query, [batchId, companyId]);

    return result.rows.length > 0;
  }

  /**
   * Add product to batch
   */
  async addBatchItem(batchId, companyId, itemData) {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');

      // Check batch exists and belongs to company
      const batchCheck = await client.query(
        'SELECT id, status FROM product_batches WHERE id = $1 AND company_id = $2',
        [batchId, companyId]
      );

      if (batchCheck.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      if (batchCheck.rows[0].status === 'published') {
        throw new Error('BATCH_ALREADY_PUBLISHED');
      }

      // Check product exists and belongs to company
      const productCheck = await client.query(
        'SELECT id, total_co2e, weight_kg FROM products WHERE id = $1 AND company_id = $2',
        [itemData.product_id, companyId]
      );

      if (productCheck.rows.length === 0) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      const product = productCheck.rows[0];

      // Insert item
      const insertQuery = `
        INSERT INTO product_batch_items (
          batch_id,
          product_id,
          quantity,
          weight_kg,
          co2_per_unit
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at
      `;

      const itemResult = await client.query(insertQuery, [
        batchId,
        itemData.product_id,
        itemData.quantity,
        itemData.weight_kg || product.weight_kg,
        itemData.co2_per_unit || product.total_co2e
      ]);

      // Recalculate batch totals
      await this._recalculateBatchTotals(client, batchId);

      await client.query('COMMIT');

      return {
        id: itemResult.rows[0].id,
        createdAt: itemResult.rows[0].created_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update batch item
   */
  async updateBatchItem(batchId, companyId, productId, updateData) {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');

      // Check batch belongs to company
      const batchCheck = await client.query(
        'SELECT id FROM product_batches WHERE id = $1 AND company_id = $2',
        [batchId, companyId]
      );

      if (batchCheck.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      // Update item
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (updateData.quantity !== undefined) {
        updates.push(`quantity = $${paramIndex}`);
        params.push(updateData.quantity);
        paramIndex++;
      }

      if (updateData.weight_kg !== undefined) {
        updates.push(`weight_kg = $${paramIndex}`);
        params.push(updateData.weight_kg);
        paramIndex++;
      }

      if (updateData.co2_per_unit !== undefined) {
        updates.push(`co2_per_unit = $${paramIndex}`);
        params.push(updateData.co2_per_unit);
        paramIndex++;
      }

      if (updates.length === 0) {
        await client.query('COMMIT');
        return { success: true };
      }

      params.push(batchId, productId);

      const updateQuery = `
        UPDATE product_batch_items
        SET ${updates.join(', ')}
        WHERE batch_id = $${paramIndex} AND product_id = $${paramIndex + 1}
        RETURNING id
      `;

      const result = await client.query(updateQuery, params);

      if (result.rows.length === 0) {
        throw new Error('BATCH_ITEM_NOT_FOUND');
      }

      // Recalculate batch totals
      await this._recalculateBatchTotals(client, batchId);

      await client.query('COMMIT');

      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Remove product from batch
   */
  async deleteBatchItem(batchId, companyId, productId) {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');

      // Check batch belongs to company
      const batchCheck = await client.query(
        'SELECT id FROM product_batches WHERE id = $1 AND company_id = $2',
        [batchId, companyId]
      );

      if (batchCheck.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      // Delete item
      const deleteQuery = `
        DELETE FROM product_batch_items
        WHERE batch_id = $1 AND product_id = $2
        RETURNING id
      `;

      const result = await client.query(deleteQuery, [batchId, productId]);

      if (result.rows.length === 0) {
        throw new Error('BATCH_ITEM_NOT_FOUND');
      }

      // Recalculate batch totals
      await this._recalculateBatchTotals(client, batchId);

      await client.query('COMMIT');

      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  _toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  _parseJsonObject(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  _normalizeTransportMode(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return TRANSPORT_MODE_ALIASES[raw] || null;
  }

  _hasCoordinates(location) {
    return (
      location &&
      Number.isFinite(this._toNumber(location.lat, Number.NaN)) &&
      Number.isFinite(this._toNumber(location.lng, Number.NaN))
    );
  }

  _distanceKm(origin, destination) {
    const originLat = this._toNumber(origin.lat, Number.NaN);
    const originLng = this._toNumber(origin.lng, Number.NaN);
    const destLat = this._toNumber(destination.lat, Number.NaN);
    const destLng = this._toNumber(destination.lng, Number.NaN);
    if (![originLat, originLng, destLat, destLng].every(Number.isFinite)) {
      return 0;
    }

    const toRadians = (value) => value * Math.PI / 180;
    const earthRadiusKm = 6371;
    const latDelta = toRadians(destLat - originLat);
    const lngDelta = toRadians(destLng - originLng);
    const a =
      Math.sin(latDelta / 2) ** 2 +
      Math.cos(toRadians(originLat)) *
        Math.cos(toRadians(destLat)) *
        Math.sin(lngDelta / 2) ** 2;
    return Math.max(0, earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  _buildBatchShipmentLegs(batch, originData, destData, totalWeightKg) {
    const transportModes = Array.isArray(batch.transport_modes) ? batch.transport_modes : [];
    const normalizedModes = transportModes
      .map((mode) => this._normalizeTransportMode(mode))
      .filter(Boolean);
    const uniqueModes = [...new Set(normalizedModes)];

    if (uniqueModes.length === 0) {
      return { legs: [], skipReason: 'MISSING_TRANSPORT_MODE' };
    }
    if (uniqueModes.length > 1) {
      return { legs: [], skipReason: 'MISSING_MULTIMODAL_LEG_DISTANCES' };
    }
    if (!this._hasCoordinates(originData) || !this._hasCoordinates(destData)) {
      return { legs: [], skipReason: 'MISSING_ROUTE_DISTANCE' };
    }

    const mode = uniqueModes[0];
    const distanceKm = this._distanceKm(originData, destData);
    if (distanceKm <= 0) {
      return { legs: [], skipReason: 'MISSING_ROUTE_DISTANCE' };
    }

    const emissionFactor = DEFAULT_EMISSION_FACTOR_BY_MODE[mode];
    const co2e = Math.max(0, (totalWeightKg / 1000) * distanceKm * emissionFactor);

    return {
      legs: [
        {
          leg_order: 1,
          transport_mode: mode,
          origin_location: originData.city || originData.country,
          destination_location: destData.city || destData.country,
          distance_km: distanceKm,
          duration_hours: 0,
          co2e,
          emission_factor_used: emissionFactor,
          carrier_name: null,
          vehicle_type: mode
        }
      ],
      skipReason: null
    };
  }

  /**
   * Publish batch (and optionally create shipment)
   */
  async publishBatch(batchId, companyId, userId) {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');

      // Get full batch data
      const batchCheck = await client.query(`
        SELECT
          pb.id,
          pb.batch_name,
          pb.status,
          pb.total_products,
          pb.total_weight_kg,
          pb.total_co2e,
          pb.origin_address,
          pb.destination_address,
          pb.transport_modes
        FROM product_batches pb
        WHERE pb.id = $1 AND pb.company_id = $2
      `, [batchId, companyId]);

      if (batchCheck.rows.length === 0) {
        throw new Error('BATCH_NOT_FOUND');
      }

      const batch = batchCheck.rows[0];

      if (batch.status === 'published') {
        throw new Error('BATCH_ALREADY_PUBLISHED');
      }

      if (batch.total_products === 0) {
        throw new Error('BATCH_EMPTY');
      }

      const batchProductsResult = await client.query(
        `
        SELECT product_id
        FROM product_batch_items
        WHERE batch_id = $1
        `,
        [batchId]
      );

      const productIds = batchProductsResult.rows.map((row) => row.product_id);
      if (productIds.length === 0) {
        throw new Error('BATCH_EMPTY');
      }

      const domesticComplianceValidation =
        await this.complianceService.validateProductsForDomesticPublish(
          client,
          companyId,
          productIds
        );

      if (!domesticComplianceValidation.success) {
        throw this.complianceService.createMissingDocumentsError(domesticComplianceValidation);
      }

      let shipmentId = null;
      let shipmentCreationSkipReason = null;

      // Create shipment only when the batch has enough defensible route data.
      if (batch.origin_address && batch.destination_address) {
        const originData = this._parseJsonObject(batch.origin_address);
        const destData = this._parseJsonObject(batch.destination_address);

        if (!originData?.country || !destData?.country) {
          shipmentCreationSkipReason = 'MISSING_LOCATION_COUNTRY';
        } else {
          // Get batch items with products
          const itemsQuery = `
            SELECT
              pbi.product_id,
              pbi.quantity,
              pbi.weight_kg,
              pbi.co2_per_unit,
              p.total_co2e
            FROM product_batch_items pbi
            JOIN products p ON p.id = pbi.product_id
            WHERE pbi.batch_id = $1
          `;
          const itemsResult = await client.query(itemsQuery, [batchId]);

          if (itemsResult.rows.length > 0) {
            // Prepare products for shipment
            const products = itemsResult.rows.map(item => ({
              product_id: item.product_id,
              quantity: parseInt(item.quantity),
              weight_kg: parseFloat(item.weight_kg || 0),
              allocated_co2e: parseFloat(item.co2_per_unit || item.total_co2e || 0) * parseInt(item.quantity)
            }));

            const totalWeightKg = products.reduce(
              (sum, p) => sum + parseFloat(p.weight_kg) * parseFloat(p.quantity),
              0
            );
            const { legs, skipReason } = this._buildBatchShipmentLegs(
              batch,
              originData,
              destData,
              totalWeightKg
            );

            if (skipReason) {
              shipmentCreationSkipReason = skipReason;
            }

            const totalDistanceKm = legs.reduce((sum, leg) => sum + parseFloat(leg.distance_km || 0), 0);
            const totalCo2e = legs.reduce((sum, leg) => sum + parseFloat(leg.co2e || 0), 0);

            if (legs.length === 0) {
              shipmentCreationSkipReason = shipmentCreationSkipReason || 'MISSING_ROUTE_DISTANCE';
            } else {
              const countResult = await client.query(
                'SELECT COUNT(*) as count FROM shipments WHERE company_id = $1',
                [companyId]
              );
              const count = parseInt(countResult.rows[0].count) + 1;
              const refNumber = `SHIP-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;

              const shipmentQuery = `
              INSERT INTO shipments (
                company_id,
                reference_number,
                status,
                origin_country,
                origin_city,
                origin_address,
                origin_lat,
                origin_lng,
                destination_country,
                destination_city,
                destination_address,
                destination_lat,
                destination_lng,
                total_weight_kg,
                total_distance_km,
                total_co2e,
                estimated_arrival
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
              RETURNING id
            `;

              const shipmentResult = await client.query(shipmentQuery, [
                companyId,
                refNumber,
                'pending',
                originData.country,
                originData.city || null,
                originData.address || null,
                originData.lat || null,
                originData.lng || null,
                destData.country,
                destData.city || null,
                destData.address || null,
                destData.lat || null,
                destData.lng || null,
                totalWeightKg,
                totalDistanceKm,
                totalCo2e,
                null
              ]);

              shipmentId = shipmentResult.rows[0].id;

              for (const leg of legs) {
                await client.query(
                  `INSERT INTO shipment_legs (
                  shipment_id,
                  leg_order,
                  transport_mode,
                  origin_location,
                  destination_location,
                  distance_km,
                  duration_hours,
                  co2e,
                  emission_factor_used,
                  carrier_name,
                  vehicle_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                  [
                    shipmentId,
                    leg.leg_order,
                    leg.transport_mode,
                    leg.origin_location,
                    leg.destination_location,
                    leg.distance_km,
                    leg.duration_hours,
                    leg.co2e,
                    leg.emission_factor_used,
                    leg.carrier_name,
                    leg.vehicle_type
                  ]
                );
              }

              for (const product of products) {
                await client.query(
                  `INSERT INTO shipment_products (
                  shipment_id,
                  product_id,
                  quantity,
                  weight_kg,
                  allocated_co2e
                ) VALUES ($1, $2, $3, $4, $5)`,
                  [
                    shipmentId,
                    product.product_id,
                    product.quantity,
                    product.weight_kg,
                    product.allocated_co2e
                  ]
                );
              }
            }
          } else {
            shipmentCreationSkipReason = 'MISSING_BATCH_ITEMS';
          }
        }
      } else {
        shipmentCreationSkipReason = 'MISSING_LOGISTICS_DATA';
      }

      // Update batch status and link shipment
      const updateQuery = `
        UPDATE product_batches
        SET
          status = 'published',
          published_at = now(),
          updated_at = now(),
          shipment_id = $2
        WHERE id = $1
        RETURNING id, status, published_at, updated_at, shipment_id
      `;

      const result = await client.query(updateQuery, [batchId, shipmentId]);

      await client.query('COMMIT');

      const response = {
        id: result.rows[0].id,
        status: result.rows[0].status,
        publishedAt: result.rows[0].published_at,
        updatedAt: result.rows[0].updated_at,
        shipmentId: result.rows[0].shipment_id
      };

      if (!shipmentId && shipmentCreationSkipReason) {
        const skipMessages = {
          MISSING_LOGISTICS_DATA:
            'Batch published successfully but shipment was not created (missing origin or destination address)',
          MISSING_LOCATION_COUNTRY:
            'Batch published successfully but shipment was not created (missing country in location data)',
          MISSING_TRANSPORT_MODE:
            'Batch published successfully but shipment was not created (missing transport mode)',
          MISSING_MULTIMODAL_LEG_DISTANCES:
            'Batch published successfully but shipment was not created (multimodal batches need explicit leg distances)',
          MISSING_ROUTE_DISTANCE:
            'Batch published successfully but shipment was not created (missing route coordinates or distance)',
          MISSING_BATCH_ITEMS:
            'Batch published successfully but shipment was not created (missing batch item details)'
        };
        response.shipmentCreationSkipped = true;
        response.skipReason = shipmentCreationSkipReason;
        response.message =
          skipMessages[shipmentCreationSkipReason] ||
          'Batch published successfully but shipment was not created (insufficient logistics data)';
      }

      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Recalculate batch totals (internal helper)
   */
  async _recalculateBatchTotals(client, batchId) {
    const query = `
      UPDATE product_batches
      SET
        total_products = (SELECT COUNT(*) FROM product_batch_items WHERE batch_id = $1),
        total_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM product_batch_items WHERE batch_id = $1),
        total_weight_kg = (SELECT COALESCE(SUM(quantity * weight_kg), 0) FROM product_batch_items WHERE batch_id = $1),
        total_co2e = (SELECT COALESCE(SUM(quantity * co2_per_unit), 0) FROM product_batch_items WHERE batch_id = $1),
        updated_at = now()
      WHERE id = $1
    `;

    await client.query(query, [batchId]);
  }
}

function createBatchesService(dependencies) {
  return new BatchesService(dependencies);
}

const batchesService = createBatchesService();

module.exports = batchesService;
module.exports.BatchesService = BatchesService;
module.exports.createBatchesService = createBatchesService;
