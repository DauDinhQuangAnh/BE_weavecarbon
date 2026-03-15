const pool = require('../config/database');
const {
  buildShipmentSimulationState,
  createBusinessError,
  ensureShipmentSimulationSchema,
  syncCompanyShipmentSimulation,
  syncShipmentSimulationById,
  toLegacyDate
} = require('./shipmentSimulationService');

/**
 * Logistics Service
 * Handles shipments, legs, and products
 */

const toFloat = (value) => parseFloat(value || 0);

const parseCoordinate = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapShipmentSummaryRow = (row) => ({
  id: row.id,
  reference_number: row.reference_number,
  status: row.status,
  origin: {
    country: row.origin_country,
    city: row.origin_city,
    address: row.origin_address,
    lat: parseCoordinate(row.origin_lat),
    lng: parseCoordinate(row.origin_lng)
  },
  destination: {
    country: row.destination_country,
    city: row.destination_city,
    address: row.destination_address,
    lat: parseCoordinate(row.destination_lat),
    lng: parseCoordinate(row.destination_lng)
  },
  total_weight_kg: toFloat(row.total_weight_kg),
  total_distance_km: toFloat(row.total_distance_km),
  total_co2e: toFloat(row.total_co2e),
  estimated_arrival: row.estimated_arrival,
  estimated_arrival_at: row.estimated_arrival_at,
  actual_arrival: row.actual_arrival,
  actual_arrival_at: row.actual_arrival_at,
  pending_until: row.pending_until,
  simulation_enabled: row.simulation_enabled === true,
  legs_count: Number.parseInt(row.legs_count || 0, 10),
  products_count: Number.parseInt(row.products_count || 0, 10),
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapShipmentMutationRow = (row) => ({
  id: row.id,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
  estimated_arrival: row.estimated_arrival,
  estimated_arrival_at: row.estimated_arrival_at,
  actual_arrival: row.actual_arrival,
  actual_arrival_at: row.actual_arrival_at,
  pending_until: row.pending_until,
  simulation_enabled: row.simulation_enabled === true
});

const getUserIsDemo = async (client, userId) => {
  if (!userId) return false;

  const result = await client.query(
    'SELECT is_demo_user FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0]?.is_demo_user === true;
};

const getShipmentLegs = async (client, shipmentId) => {
  const legsResult = await client.query(
    `
      SELECT
        id,
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
      FROM shipment_legs
      WHERE shipment_id = $1
      ORDER BY leg_order ASC
    `,
    [shipmentId]
  );

  return legsResult.rows;
};

const getShipmentProducts = async (client, shipmentId) => {
  const productsResult = await client.query(
    `
      SELECT
        sp.id,
        sp.product_id,
        sp.quantity,
        sp.weight_kg,
        sp.allocated_co2e,
        p.sku,
        p.name AS product_name
      FROM shipment_products sp
      LEFT JOIN products p ON p.id = sp.product_id
      WHERE sp.shipment_id = $1
      ORDER BY sp.created_at ASC
    `,
    [shipmentId]
  );

  return productsResult.rows;
};

const getShipmentForUpdate = async (client, shipmentId, companyId) => {
  const result = await client.query(
    `
      SELECT
        id,
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
        pending_until,
        estimated_arrival,
        estimated_arrival_at,
        actual_arrival,
        actual_arrival_at,
        simulation_enabled,
        created_at,
        updated_at
      FROM shipments
      WHERE id = $1 AND company_id = $2
      FOR UPDATE
    `,
    [shipmentId, companyId]
  );

  return result.rows[0] || null;
};

/**
 * List shipments for a company with filters
 */
async function listShipments(companyId, filters = {}) {
  try {
    await ensureShipmentSimulationSchema();
    await syncCompanyShipmentSimulation(companyId);

    const {
      search,
      status,
      transport_mode,
      date_from,
      date_to,
      page = 1,
      page_size = 20,
      sort_by = 'updated_at',
      sort_order = 'desc'
    } = filters;

    let query = `
      SELECT
        s.id,
        s.company_id,
        s.reference_number,
        s.status,
        s.origin_country,
        s.origin_city,
        s.origin_address,
        s.origin_lat,
        s.origin_lng,
        s.destination_country,
        s.destination_city,
        s.destination_address,
        s.destination_lat,
        s.destination_lng,
        s.total_weight_kg,
        s.total_distance_km,
        s.total_co2e,
        s.pending_until,
        s.estimated_arrival,
        s.estimated_arrival_at,
        s.actual_arrival,
        s.actual_arrival_at,
        s.simulation_enabled,
        s.created_at,
        s.updated_at,
        COUNT(DISTINCT sl.id) AS legs_count,
        COUNT(DISTINCT sp.id) AS products_count
      FROM shipments s
      LEFT JOIN shipment_legs sl ON s.id = sl.shipment_id
      LEFT JOIN shipment_products sp ON s.id = sp.shipment_id
      WHERE s.company_id = $1
    `;

    const params = [companyId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (
        s.reference_number ILIKE $${paramIndex}
        OR s.id::text ILIKE $${paramIndex}
        OR sl.carrier_name ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    if (status && status !== 'all') {
      query += ` AND s.status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    if (transport_mode) {
      query += ` AND EXISTS (
        SELECT 1
        FROM shipment_legs
        WHERE shipment_id = s.id AND transport_mode = $${paramIndex}
      )`;
      params.push(transport_mode);
      paramIndex += 1;
    }

    if (date_from) {
      query += ` AND COALESCE(s.estimated_arrival_at::date, s.estimated_arrival) >= $${paramIndex}`;
      params.push(date_from);
      paramIndex += 1;
    }

    if (date_to) {
      query += ` AND COALESCE(s.estimated_arrival_at::date, s.estimated_arrival) <= $${paramIndex}`;
      params.push(date_to);
      paramIndex += 1;
    }

    query += ' GROUP BY s.id';

    const sortColumns = {
      created_at: 's.created_at',
      updated_at: 's.updated_at',
      estimated_arrival: 'COALESCE(s.estimated_arrival_at, s.estimated_arrival::timestamptz)',
      total_co2e: 's.total_co2e'
    };
    const sortColumn = sortColumns[sort_by] || sortColumns.updated_at;
    query += ` ORDER BY ${sortColumn} ${sort_order.toUpperCase()}`;

    const offset = (page - 1) * page_size;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(page_size, offset);

    const result = await pool.query(query, params);

    let countQuery = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM shipments s
      LEFT JOIN shipment_legs sl ON s.id = sl.shipment_id
      WHERE s.company_id = $1
    `;

    const countParams = [companyId];
    let countParamIndex = 2;

    if (search) {
      countQuery += ` AND (
        s.reference_number ILIKE $${countParamIndex}
        OR s.id::text ILIKE $${countParamIndex}
        OR sl.carrier_name ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex += 1;
    }

    if (status && status !== 'all') {
      countQuery += ` AND s.status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex += 1;
    }

    if (transport_mode) {
      countQuery += ` AND EXISTS (
        SELECT 1
        FROM shipment_legs
        WHERE shipment_id = s.id AND transport_mode = $${countParamIndex}
      )`;
      countParams.push(transport_mode);
      countParamIndex += 1;
    }

    if (date_from) {
      countQuery += ` AND COALESCE(s.estimated_arrival_at::date, s.estimated_arrival) >= $${countParamIndex}`;
      countParams.push(date_from);
      countParamIndex += 1;
    }

    if (date_to) {
      countQuery += ` AND COALESCE(s.estimated_arrival_at::date, s.estimated_arrival) <= $${countParamIndex}`;
      countParams.push(date_to);
      countParamIndex += 1;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = Number.parseInt(countResult.rows[0]?.total || 0, 10);

    return {
      items: result.rows.map(mapShipmentSummaryRow),
      pagination: {
        page: Number.parseInt(page, 10),
        page_size: Number.parseInt(page_size, 10),
        total,
        total_pages: Math.ceil(total / page_size)
      }
    };
  } catch (error) {
    console.error('Error listing shipments:', error);
    throw error;
  }
}

/**
 * Get shipment by ID with legs and products
 */
async function getShipmentById(shipmentId, companyId) {
  try {
    await ensureShipmentSimulationSchema();
    await syncCompanyShipmentSimulation(companyId);

    const client = await pool.connect();

    try {
      const shipment = await getShipmentForUpdate(client, shipmentId, companyId);

      if (!shipment) {
        return null;
      }

      const legs = await getShipmentLegs(client, shipmentId);
      const products = await getShipmentProducts(client, shipmentId);

      return {
        id: shipment.id,
        company_id: shipment.company_id,
        reference_number: shipment.reference_number,
        status: shipment.status,
        origin: {
          country: shipment.origin_country,
          city: shipment.origin_city,
          address: shipment.origin_address,
          lat: parseCoordinate(shipment.origin_lat),
          lng: parseCoordinate(shipment.origin_lng)
        },
        destination: {
          country: shipment.destination_country,
          city: shipment.destination_city,
          address: shipment.destination_address,
          lat: parseCoordinate(shipment.destination_lat),
          lng: parseCoordinate(shipment.destination_lng)
        },
        total_weight_kg: toFloat(shipment.total_weight_kg),
        total_distance_km: toFloat(shipment.total_distance_km),
        total_co2e: toFloat(shipment.total_co2e),
        pending_until: shipment.pending_until,
        estimated_arrival: shipment.estimated_arrival,
        estimated_arrival_at: shipment.estimated_arrival_at,
        actual_arrival: shipment.actual_arrival,
        actual_arrival_at: shipment.actual_arrival_at,
        simulation_enabled: shipment.simulation_enabled === true,
        created_at: shipment.created_at,
        updated_at: shipment.updated_at,
        legs,
        products
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error getting shipment:', error);
    throw error;
  }
}

/**
 * Create new shipment with legs and products
 */
async function createShipment(companyId, userId, shipmentData) {
  await ensureShipmentSimulationSchema();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      reference_number,
      origin,
      destination,
      estimated_arrival,
      legs,
      products
    } = shipmentData;

    const isDemoUser = await getUserIsDemo(client, userId);

    if (products && products.length > 0) {
      const productIds = products.map((product) => product.product_id);
      const productCheck = await client.query(
        'SELECT id FROM products WHERE id = ANY($1) AND company_id = $2',
        [productIds, companyId]
      );

      if (productCheck.rows.length !== productIds.length) {
        throw new Error('PRODUCT_NOT_IN_COMPANY');
      }
    }

    const totalDistanceKm = legs.reduce(
      (sum, leg) => sum + parseFloat(leg.distance_km),
      0
    );
    const totalWeightKg = products.reduce(
      (sum, product) => sum + parseFloat(product.weight_kg),
      0
    );
    const totalCo2e = legs.reduce((sum, leg) => sum + parseFloat(leg.co2e), 0);

    let refNumber = reference_number;
    if (!refNumber) {
      const countResult = await client.query(
        'SELECT COUNT(*) AS count FROM shipments WHERE company_id = $1',
        [companyId]
      );
      const count = Number.parseInt(countResult.rows[0]?.count || 0, 10) + 1;
      refNumber = `SHIP-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;
    }

    const createdAt = new Date();
    const simulation = buildShipmentSimulationState({
      createdAt,
      originCountry: origin.country,
      destinationCountry: destination.country,
      legs,
      totalDistanceKm,
      simulationAllowed: !isDemoUser
    });
    const legacyEstimatedArrival =
      simulation.simulation_enabled ?
        simulation.estimated_arrival :
        estimated_arrival || null;

    const shipmentResult = await client.query(
      `
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
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          simulation_enabled,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $21
        )
        RETURNING
          id,
          status,
          created_at,
          updated_at,
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          actual_arrival,
          actual_arrival_at,
          simulation_enabled
      `,
      [
        companyId,
        refNumber,
        'pending',
        origin.country,
        origin.city || null,
        origin.address || null,
        origin.lat || null,
        origin.lng || null,
        destination.country,
        destination.city || null,
        destination.address || null,
        destination.lat || null,
        destination.lng || null,
        totalWeightKg,
        totalDistanceKm,
        totalCo2e,
        simulation.pending_until,
        legacyEstimatedArrival,
        simulation.estimated_arrival_at,
        simulation.simulation_enabled,
        createdAt
      ]
    );

    const shipmentId = shipmentResult.rows[0].id;

    for (const leg of legs) {
      await client.query(
        `
          INSERT INTO shipment_legs (
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          shipmentId,
          leg.leg_order,
          leg.transport_mode,
          leg.origin_location,
          leg.destination_location,
          leg.distance_km,
          leg.duration_hours || null,
          leg.co2e,
          leg.emission_factor_used || null,
          leg.carrier_name || null,
          leg.vehicle_type || null
        ]
      );
    }

    for (const product of products) {
      await client.query(
        `
          INSERT INTO shipment_products (
            shipment_id,
            product_id,
            quantity,
            weight_kg,
            allocated_co2e
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          shipmentId,
          product.product_id,
          product.quantity,
          product.weight_kg,
          product.allocated_co2e
        ]
      );
    }

    await client.query('COMMIT');

    return mapShipmentMutationRow(shipmentResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating shipment:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update shipment metadata (not legs/products)
 */
async function updateShipment(shipmentId, companyId, updates) {
  await ensureShipmentSimulationSchema();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const shipment = await getShipmentForUpdate(client, shipmentId, companyId);
    if (!shipment) {
      await client.query('ROLLBACK');
      return null;
    }

    const setClauses = [];
    const params = [shipmentId, companyId];
    let paramIndex = 3;

    const nextOrigin = {
      country: shipment.origin_country,
      city: shipment.origin_city,
      address: shipment.origin_address,
      lat: shipment.origin_lat,
      lng: shipment.origin_lng
    };
    const nextDestination = {
      country: shipment.destination_country,
      city: shipment.destination_city,
      address: shipment.destination_address,
      lat: shipment.destination_lat,
      lng: shipment.destination_lng
    };

    let shouldRecomputeSimulation = false;

    if (updates.reference_number !== undefined) {
      setClauses.push(`reference_number = $${paramIndex}`);
      params.push(updates.reference_number || null);
      paramIndex += 1;
    }

    if (updates.origin && typeof updates.origin === 'object') {
      if (updates.origin.country !== undefined) {
        nextOrigin.country = updates.origin.country;
        setClauses.push(`origin_country = $${paramIndex}`);
        params.push(updates.origin.country);
        paramIndex += 1;
        shouldRecomputeSimulation = shipment.simulation_enabled === true;
      }
      if (updates.origin.city !== undefined) {
        nextOrigin.city = updates.origin.city;
        setClauses.push(`origin_city = $${paramIndex}`);
        params.push(updates.origin.city);
        paramIndex += 1;
      }
      if (updates.origin.address !== undefined) {
        nextOrigin.address = updates.origin.address;
        setClauses.push(`origin_address = $${paramIndex}`);
        params.push(updates.origin.address);
        paramIndex += 1;
      }
      if (updates.origin.lat !== undefined) {
        nextOrigin.lat = updates.origin.lat;
        setClauses.push(`origin_lat = $${paramIndex}`);
        params.push(updates.origin.lat);
        paramIndex += 1;
      }
      if (updates.origin.lng !== undefined) {
        nextOrigin.lng = updates.origin.lng;
        setClauses.push(`origin_lng = $${paramIndex}`);
        params.push(updates.origin.lng);
        paramIndex += 1;
      }
    }

    if (updates.destination && typeof updates.destination === 'object') {
      if (updates.destination.country !== undefined) {
        nextDestination.country = updates.destination.country;
        setClauses.push(`destination_country = $${paramIndex}`);
        params.push(updates.destination.country);
        paramIndex += 1;
        shouldRecomputeSimulation = shipment.simulation_enabled === true;
      }
      if (updates.destination.city !== undefined) {
        nextDestination.city = updates.destination.city;
        setClauses.push(`destination_city = $${paramIndex}`);
        params.push(updates.destination.city);
        paramIndex += 1;
      }
      if (updates.destination.address !== undefined) {
        nextDestination.address = updates.destination.address;
        setClauses.push(`destination_address = $${paramIndex}`);
        params.push(updates.destination.address);
        paramIndex += 1;
      }
      if (updates.destination.lat !== undefined) {
        nextDestination.lat = updates.destination.lat;
        setClauses.push(`destination_lat = $${paramIndex}`);
        params.push(updates.destination.lat);
        paramIndex += 1;
      }
      if (updates.destination.lng !== undefined) {
        nextDestination.lng = updates.destination.lng;
        setClauses.push(`destination_lng = $${paramIndex}`);
        params.push(updates.destination.lng);
        paramIndex += 1;
      }
    }

    if (shipment.simulation_enabled !== true && updates.estimated_arrival !== undefined) {
      setClauses.push(`estimated_arrival = $${paramIndex}`);
      params.push(updates.estimated_arrival || null);
      paramIndex += 1;
    }

    if (shouldRecomputeSimulation) {
      const legs = await getShipmentLegs(client, shipmentId);
      const simulation = buildShipmentSimulationState({
        createdAt: shipment.created_at,
        pendingUntil: shipment.pending_until,
        originCountry: nextOrigin.country,
        destinationCountry: nextDestination.country,
        legs,
        totalDistanceKm: shipment.total_distance_km,
        simulationAllowed: true
      });

      setClauses.push(`simulation_enabled = $${paramIndex}`);
      params.push(simulation.simulation_enabled);
      paramIndex += 1;

      setClauses.push(`pending_until = $${paramIndex}`);
      params.push(simulation.pending_until);
      paramIndex += 1;

      setClauses.push(`estimated_arrival_at = $${paramIndex}`);
      params.push(simulation.estimated_arrival_at);
      paramIndex += 1;

      setClauses.push(`estimated_arrival = $${paramIndex}`);
      params.push(simulation.simulation_enabled ? simulation.estimated_arrival : null);
      paramIndex += 1;
    }

    if (setClauses.length === 0) {
      await client.query('COMMIT');
      return mapShipmentMutationRow(shipment);
    }

    setClauses.push('updated_at = NOW()');

    const updateResult = await client.query(
      `
        UPDATE shipments
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND company_id = $2
        RETURNING
          id,
          status,
          created_at,
          updated_at,
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          actual_arrival,
          actual_arrival_at,
          simulation_enabled
      `,
      params
    );

    let responseRow = updateResult.rows[0];

    if (responseRow?.simulation_enabled === true) {
      responseRow = await syncShipmentSimulationById(client, shipmentId) || responseRow;
    }

    await client.query('COMMIT');
    return mapShipmentMutationRow(responseRow);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating shipment:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update shipment status with validation
 */
async function updateShipmentStatus(shipmentId, companyId, newStatus, actualArrival = null) {
  try {
    await ensureShipmentSimulationSchema();
    await syncCompanyShipmentSimulation(companyId);

    const currentResult = await pool.query(
      `
        SELECT
          id,
          status,
          simulation_enabled,
          pending_until,
          estimated_arrival_at,
          estimated_arrival,
          actual_arrival_at,
          actual_arrival,
          created_at,
          updated_at
        FROM shipments
        WHERE id = $1 AND company_id = $2
      `,
      [shipmentId, companyId]
    );

    if (currentResult.rows.length === 0) {
      return null;
    }

    const shipment = currentResult.rows[0];

    if (shipment.simulation_enabled === true) {
      if (newStatus !== 'cancelled') {
        throw createBusinessError(
          'SHIPMENT_STATUS_AUTO_MANAGED',
          'This shipment status is managed automatically by the simulation engine.',
          400
        );
      }

      if (shipment.status !== 'pending') {
        throw createBusinessError(
          'SHIPMENT_CANCELLATION_NOT_ALLOWED',
          'Only shipments that are still pending can be cancelled.',
          409
        );
      }

      const cancelledResult = await pool.query(
        `
          UPDATE shipments
          SET
            status = 'cancelled',
            updated_at = NOW()
          WHERE id = $1 AND company_id = $2
          RETURNING
            id,
            status,
            created_at,
            updated_at,
            pending_until,
            estimated_arrival,
            estimated_arrival_at,
            actual_arrival,
            actual_arrival_at,
            simulation_enabled
        `,
        [shipmentId, companyId]
      );

      return mapShipmentMutationRow(cancelledResult.rows[0]);
    }

    const currentStatus = shipment.status;
    const validTransitions = {
      pending: ['in_transit', 'cancelled'],
      in_transit: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: []
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new Error('INVALID_SHIPMENT_STATUS_TRANSITION');
    }

    const resolvedActualArrivalAt =
      newStatus === 'delivered' ?
        (actualArrival ? new Date(actualArrival) : new Date()) :
        null;
    const resolvedActualArrival =
      newStatus === 'delivered' ?
        (actualArrival || toLegacyDate(resolvedActualArrivalAt)) :
        null;

    const result = await pool.query(
      `
        UPDATE shipments
        SET
          status = $1,
          actual_arrival = $2,
          actual_arrival_at = $3,
          updated_at = NOW()
        WHERE id = $4 AND company_id = $5
        RETURNING
          id,
          status,
          created_at,
          updated_at,
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          actual_arrival,
          actual_arrival_at,
          simulation_enabled
      `,
      [
        newStatus,
        resolvedActualArrival,
        resolvedActualArrivalAt,
        shipmentId,
        companyId
      ]
    );

    return mapShipmentMutationRow(result.rows[0]);
  } catch (error) {
    console.error('Error updating shipment status:', error);
    throw error;
  }
}

/**
 * Replace all legs for a shipment
 */
async function replaceShipmentLegs(shipmentId, companyId, legs) {
  await ensureShipmentSimulationSchema();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const shipment = await getShipmentForUpdate(client, shipmentId, companyId);
    if (!shipment) {
      throw new Error('SHIPMENT_NOT_FOUND');
    }

    const legOrders = legs.map((leg) => leg.leg_order).sort((a, b) => a - b);
    for (let index = 0; index < legOrders.length; index += 1) {
      if (legOrders[index] !== index + 1) {
        throw new Error('INVALID_SHIPMENT_PAYLOAD');
      }
    }

    await client.query('DELETE FROM shipment_legs WHERE shipment_id = $1', [shipmentId]);

    for (const leg of legs) {
      await client.query(
        `
          INSERT INTO shipment_legs (
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          shipmentId,
          leg.leg_order,
          leg.transport_mode,
          leg.origin_location,
          leg.destination_location,
          leg.distance_km,
          leg.duration_hours || null,
          leg.co2e,
          leg.emission_factor_used || null,
          leg.carrier_name || null,
          leg.vehicle_type || null
        ]
      );
    }

    const totalDistanceKm = legs.reduce(
      (sum, leg) => sum + parseFloat(leg.distance_km),
      0
    );
    const totalCo2e = legs.reduce((sum, leg) => sum + parseFloat(leg.co2e), 0);

    let simulation = {
      simulation_enabled: shipment.simulation_enabled === true,
      pending_until: shipment.pending_until,
      estimated_arrival_at: shipment.estimated_arrival_at,
      estimated_arrival: shipment.estimated_arrival
    };

    if (shipment.simulation_enabled === true) {
      simulation = buildShipmentSimulationState({
        createdAt: shipment.created_at,
        pendingUntil: shipment.pending_until,
        originCountry: shipment.origin_country,
        destinationCountry: shipment.destination_country,
        legs,
        totalDistanceKm,
        simulationAllowed: true
      });
    }

    const updateResult = await client.query(
      `
        UPDATE shipments
        SET
          total_distance_km = $1,
          total_co2e = $2,
          simulation_enabled = $3,
          pending_until = $4,
          estimated_arrival_at = $5,
          estimated_arrival = $6,
          updated_at = NOW()
        WHERE id = $7
        RETURNING
          id,
          status,
          created_at,
          updated_at,
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          actual_arrival,
          actual_arrival_at,
          simulation_enabled,
          total_distance_km,
          total_co2e
      `,
      [
        totalDistanceKm,
        totalCo2e,
        simulation.simulation_enabled,
        simulation.pending_until,
        simulation.estimated_arrival_at,
        simulation.simulation_enabled ? simulation.estimated_arrival : null,
        shipmentId
      ]
    );

    let responseRow = updateResult.rows[0];
    if (responseRow?.simulation_enabled === true) {
      responseRow = await syncShipmentSimulationById(client, shipmentId) || responseRow;
    }

    await client.query('COMMIT');

    return {
      ...mapShipmentMutationRow(responseRow),
      total_distance_km: toFloat(updateResult.rows[0]?.total_distance_km),
      total_co2e: toFloat(updateResult.rows[0]?.total_co2e),
      legs_count: legs.length
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error replacing shipment legs:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Replace all products for a shipment
 */
async function replaceShipmentProducts(shipmentId, companyId, products) {
  await ensureShipmentSimulationSchema();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const shipmentCheck = await client.query(
      'SELECT id FROM shipments WHERE id = $1 AND company_id = $2',
      [shipmentId, companyId]
    );

    if (shipmentCheck.rows.length === 0) {
      throw new Error('SHIPMENT_NOT_FOUND');
    }

    const productIds = products.map((product) => product.product_id);
    const productCheck = await client.query(
      'SELECT id FROM products WHERE id = ANY($1) AND company_id = $2',
      [productIds, companyId]
    );

    if (productCheck.rows.length !== productIds.length) {
      throw new Error('PRODUCT_NOT_IN_COMPANY');
    }

    await client.query('DELETE FROM shipment_products WHERE shipment_id = $1', [shipmentId]);

    for (const product of products) {
      await client.query(
        `
          INSERT INTO shipment_products (
            shipment_id,
            product_id,
            quantity,
            weight_kg,
            allocated_co2e
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          shipmentId,
          product.product_id,
          product.quantity,
          product.weight_kg,
          product.allocated_co2e
        ]
      );
    }

    const totalWeightKg = products.reduce(
      (sum, product) => sum + parseFloat(product.weight_kg),
      0
    );
    const totalCo2e = products.reduce(
      (sum, product) => sum + parseFloat(product.allocated_co2e),
      0
    );

    const updateResult = await client.query(
      `
        UPDATE shipments
        SET
          total_weight_kg = $1,
          total_co2e = $2,
          updated_at = NOW()
        WHERE id = $3
        RETURNING
          id,
          status,
          created_at,
          updated_at,
          pending_until,
          estimated_arrival,
          estimated_arrival_at,
          actual_arrival,
          actual_arrival_at,
          simulation_enabled,
          total_weight_kg,
          total_co2e
      `,
      [totalWeightKg, totalCo2e, shipmentId]
    );

    await client.query('COMMIT');

    return {
      ...mapShipmentMutationRow(updateResult.rows[0]),
      total_weight_kg: toFloat(updateResult.rows[0]?.total_weight_kg),
      total_co2e: toFloat(updateResult.rows[0]?.total_co2e),
      products_count: products.length
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error replacing shipment products:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get logistics overview stats for company
 */
async function getLogisticsOverview(companyId) {
  try {
    await ensureShipmentSimulationSchema();
    await syncCompanyShipmentSimulation(companyId);

    const result = await pool.query(
      `
        SELECT
          COUNT(*) AS total_shipments,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
          COALESCE(SUM(total_co2e), 0) AS total_co2e
        FROM shipments
        WHERE company_id = $1
      `,
      [companyId]
    );

    return {
      total_shipments: Number.parseInt(result.rows[0]?.total_shipments || 0, 10),
      pending: Number.parseInt(result.rows[0]?.pending || 0, 10),
      in_transit: Number.parseInt(result.rows[0]?.in_transit || 0, 10),
      delivered: Number.parseInt(result.rows[0]?.delivered || 0, 10),
      cancelled: Number.parseInt(result.rows[0]?.cancelled || 0, 10),
      total_co2e: toFloat(result.rows[0]?.total_co2e)
    };
  } catch (error) {
    console.error('Error getting logistics overview:', error);
    throw error;
  }
}

module.exports = {
  listShipments,
  getShipmentById,
  createShipment,
  updateShipment,
  updateShipmentStatus,
  replaceShipmentLegs,
  replaceShipmentProducts,
  getLogisticsOverview
};
