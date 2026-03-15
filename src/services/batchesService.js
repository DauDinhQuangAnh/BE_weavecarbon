/**
 * Batches Service
 * Business logic for product batch management
 */

const pool = require('../config/database');
const domesticComplianceService = require('./domesticComplianceService');

class BatchesService {
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
    const countResult = await pool.query(countQuery, params);
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

    const result = await pool.query(query, params);

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
    const batchResult = await pool.query(batchQuery, [batchId, companyId]);

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
    const itemsResult = await pool.query(itemsQuery, [batchId]);

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

    const result = await pool.query(query, [
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
    const checkResult = await pool.query(checkQuery, [batchId, companyId]);

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

    const result = await pool.query(query, params);

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

    const result = await pool.query(query, [batchId, companyId]);

    return result.rows.length > 0;
  }

  /**
   * Add product to batch
   */
  async addBatchItem(batchId, companyId, itemData) {
    const client = await pool.connect();

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
    const client = await pool.connect();

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
    const client = await pool.connect();

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

  /**
   * Publish batch (and optionally create shipment)
   */
  async publishBatch(batchId, companyId, userId) {
    const client = await pool.connect();

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
        await domesticComplianceService.validateProductsForDomesticPublish(
          client,
          companyId,
          productIds
        );

      if (!domesticComplianceValidation.success) {
        throw domesticComplianceService.createMissingDocumentsError(domesticComplianceValidation);
      }

      let shipmentId = null;
      let shipmentCreationSkipReason = null;

      // Create shipment if batch has logistics data
      // Require at minimum: origin and destination with country
      if (batch.origin_address && batch.destination_address) {
        const originData = typeof batch.origin_address === 'string' 
          ? JSON.parse(batch.origin_address) 
          : batch.origin_address;
        const destData = typeof batch.destination_address === 'string'
          ? JSON.parse(batch.destination_address)
          : batch.destination_address;

        if (!originData?.country || !destData?.country) {
          console.log(`Batch ${batchId}: Origin or destination missing country, skipping shipment creation`);
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

            // Calculate totals
            const totalWeightKg = products.reduce((sum, p) => sum + parseFloat(p.weight_kg), 0);
            const totalCo2e = parseFloat(batch.total_co2e || 0);

            // Create legs from transport_modes (if available)
            let legs = [];
            const transportModes = batch.transport_modes || [];
            
            if (transportModes.length > 0) {
              const co2ePerMode = totalCo2e / transportModes.length;
              legs = transportModes.map((mode, index) => ({
                leg_order: index + 1,
                transport_mode: mode,
                origin_location: originData.city || originData.country,
                destination_location: destData.city || destData.country,
                distance_km: 0,
                duration_hours: 0,
                co2e: co2ePerMode,
                emission_factor_used: 0.1,
                carrier_name: null,
                vehicle_type: mode
              }));
            } else {
              // Create default leg if no transport modes specified
              legs = [{
                leg_order: 1,
                transport_mode: 'road',
                origin_location: originData.city || originData.country,
                destination_location: destData.city || destData.country,
                distance_km: 0,
                duration_hours: 0,
                co2e: totalCo2e,
                emission_factor_used: 0.1,
                carrier_name: null,
                vehicle_type: 'truck'
              }];
            }

            const totalDistanceKm = legs.reduce((sum, leg) => sum + parseFloat(leg.distance_km || 0), 0);

            // Generate reference number
            const countResult = await client.query(
              'SELECT COUNT(*) as count FROM shipments WHERE company_id = $1',
              [companyId]
            );
            const count = parseInt(countResult.rows[0].count) + 1;
            const refNumber = `SHIP-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;

            // Insert shipment
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

            // Insert legs
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

            // Insert products
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

            console.log(`Batch ${batchId}: Created shipment ${shipmentId} (${refNumber}) with ${products.length} products and ${legs.length} legs`);
          }
        }
      } else {
        console.log(`Batch ${batchId}: Missing origin_address or destination_address, skipping shipment creation`);
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
        response.shipmentCreationSkipped = true;
        response.skipReason = shipmentCreationSkipReason;
        response.message = shipmentCreationSkipReason === 'MISSING_LOGISTICS_DATA' 
          ? 'Batch published successfully but shipment was not created (missing origin or destination address)'
          : 'Batch published successfully but shipment was not created (missing country in location data)';
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

module.exports = new BatchesService();
