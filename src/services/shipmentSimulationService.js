const pool = require('../config/database');
const { assertSchemaCapability } = require('../config/schemaCapabilities');

const CROSS_BORDER_BUFFER_HOURS = 8;

const readIntegerEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampInteger = (value, min, max) =>
  Math.max(min, Math.min(max, value));

const SIMULATION_UTC_OFFSET_MINUTES = readIntegerEnv(
  'SHIPMENT_SIMULATION_UTC_OFFSET_MINUTES',
  7 * 60
);
const BUSINESS_START_HOUR = clampInteger(
  readIntegerEnv('SHIPMENT_SIMULATION_BUSINESS_START_HOUR', 8),
  0,
  23
);
const BUSINESS_END_HOUR = clampInteger(
  readIntegerEnv('SHIPMENT_SIMULATION_BUSINESS_END_HOUR', 18),
  BUSINESS_START_HOUR + 1,
  24
);
const PENDING_HOURS_MIN = clampInteger(
  readIntegerEnv('SHIPMENT_SIMULATION_PENDING_MIN_HOURS', 4),
  1,
  72
);
const PENDING_HOURS_MAX = clampInteger(
  readIntegerEnv('SHIPMENT_SIMULATION_PENDING_MAX_HOURS', 7),
  PENDING_HOURS_MIN,
  72
);
const SIMULATION_OFFSET_MS = SIMULATION_UTC_OFFSET_MINUTES * 60 * 1000;

const ETA_RULES_BY_MODE = {
  road: { speedKmh: 45, handlingHours: 2 },
  rail: { speedKmh: 60, handlingHours: 4 },
  sea: { speedKmh: 30, handlingHours: 12 },
  air: { speedKmh: 650, handlingHours: 6 }
};

const demoCompanyCache = new Map();

const createBusinessError = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toSimulationLocalDate = (value) => {
  const parsed = parseDate(value);
  return parsed ? new Date(parsed.getTime() + SIMULATION_OFFSET_MS) : null;
};

const fromSimulationLocalDate = (value) =>
  new Date(value.getTime() - SIMULATION_OFFSET_MS);

const formatDatePart = (value) => String(value).padStart(2, '0');

const toLegacyDate = (value) => {
  const localDate = toSimulationLocalDate(value);
  if (!localDate) return null;

  return [
    localDate.getUTCFullYear(),
    formatDatePart(localDate.getUTCMonth() + 1),
    formatDatePart(localDate.getUTCDate())
  ].join('-');
};

const addHours = (date, hours) =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

const normalizeCountry = (value) =>
  String(value || '').trim().toLowerCase();

const isCrossBorderShipment = (originCountry, destinationCountry) => {
  const origin = normalizeCountry(originCountry);
  const destination = normalizeCountry(destinationCountry);
  return Boolean(origin && destination && origin !== destination);
};

const getEtaRule = (mode) => ETA_RULES_BY_MODE[mode] || ETA_RULES_BY_MODE.road;

const getRandomPendingHours = () =>
  PENDING_HOURS_MIN +
  Math.floor(Math.random() * (PENDING_HOURS_MAX - PENDING_HOURS_MIN + 1));

const roundUpToSimulationHour = (value) => {
  const localDate = toSimulationLocalDate(value);
  if (!localDate) return null;

  const roundedLocalDate = new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    localDate.getUTCHours(),
    0,
    0,
    0
  ));

  if (
    localDate.getUTCMinutes() > 0 ||
    localDate.getUTCSeconds() > 0 ||
    localDate.getUTCMilliseconds() > 0
  ) {
    roundedLocalDate.setUTCHours(roundedLocalDate.getUTCHours() + 1);
  }

  return fromSimulationLocalDate(roundedLocalDate);
};

const moveToNextBusinessWindow = (value) => {
  const localDate = toSimulationLocalDate(value);
  if (!localDate) return null;

  const nextLocalDate = new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate() + 1,
    BUSINESS_START_HOUR,
    0,
    0,
    0
  ));

  return fromSimulationLocalDate(nextLocalDate);
};

const normalizeToBusinessHour = (value) => {
  const roundedDate = roundUpToSimulationHour(value);
  const localDate = toSimulationLocalDate(roundedDate);
  if (!localDate) return null;

  const hour = localDate.getUTCHours();

  if (hour < BUSINESS_START_HOUR) {
    return fromSimulationLocalDate(
      new Date(Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
        BUSINESS_START_HOUR,
        0,
        0,
        0
      ))
    );
  }

  if (hour >= BUSINESS_END_HOUR) {
    return moveToNextBusinessWindow(roundedDate);
  }

  return roundedDate;
};

const isAlignedToBusinessHour = (value) => {
  const localDate = toSimulationLocalDate(value);
  if (!localDate) return false;

  const hour = localDate.getUTCHours();
  return (
    localDate.getUTCMinutes() === 0 &&
    localDate.getUTCSeconds() === 0 &&
    localDate.getUTCMilliseconds() === 0 &&
    hour >= BUSINESS_START_HOUR &&
    hour <= BUSINESS_END_HOUR
  );
};

const maxDate = (left, right) => {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
};

const isBusinessHourDate = (value) => isAlignedToBusinessHour(value);

const allocateBusinessHours = (startDate, durationHours) => {
  let cursor = normalizeToBusinessHour(startDate);
  let remainingHours = Math.max(1, Math.ceil(durationHours));

  if (!cursor) return null;

  while (remainingHours > 0) {
    cursor = normalizeToBusinessHour(cursor);
    const localCursor = toSimulationLocalDate(cursor);
    if (!localCursor) return null;

    const availableHours = Math.max(0, BUSINESS_END_HOUR - localCursor.getUTCHours());
    if (availableHours <= 0) {
      cursor = moveToNextBusinessWindow(cursor);
      continue;
    }

    const consumedHours = Math.min(remainingHours, availableHours);
    cursor = addHours(cursor, consumedHours);
    remainingHours -= consumedHours;

    if (remainingHours > 0) {
      cursor = moveToNextBusinessWindow(cursor);
    }
  }

  return cursor;
};

const resolvePendingUntil = (createdAt, pendingUntil) => {
  const normalizedCreatedAt = normalizeToBusinessHour(createdAt) || parseDate(createdAt);
  const normalizedPendingUntil = normalizeToBusinessHour(pendingUntil);

  if (normalizedPendingUntil) {
    return maxDate(normalizedCreatedAt, normalizedPendingUntil);
  }

  return allocateBusinessHours(normalizedCreatedAt, getRandomPendingHours());
};

const pickDominantMode = (legs = []) => {
  const distanceByMode = new Map();

  for (const leg of legs) {
    const mode = typeof leg?.transport_mode === 'string' ? leg.transport_mode : 'road';
    const distanceKm = Math.max(0, toNumber(leg?.distance_km, 0));
    distanceByMode.set(mode, (distanceByMode.get(mode) || 0) + distanceKm);
  }

  let dominantMode = null;
  let maxDistance = -1;
  for (const [mode, totalDistance] of distanceByMode.entries()) {
    if (totalDistance > maxDistance) {
      dominantMode = mode;
      maxDistance = totalDistance;
    }
  }

  if (dominantMode) return dominantMode;

  const firstLegMode = legs.find((leg) => typeof leg?.transport_mode === 'string')?.transport_mode;
  return firstLegMode || 'road';
};

const calculateTransitHours = ({
  legs = [],
  totalDistanceKm,
  originCountry,
  destinationCountry
}) => {
  let totalHours = 0;
  let missingLegTransitData = !Array.isArray(legs) || legs.length === 0;

  if (!missingLegTransitData) {
    for (const leg of legs) {
      const durationHours = toNumber(leg?.duration_hours, Number.NaN);
      if (Number.isFinite(durationHours) && durationHours > 0) {
        totalHours += durationHours;
        continue;
      }

      const distanceKm = toNumber(leg?.distance_km, Number.NaN);
      if (Number.isFinite(distanceKm) && distanceKm > 0) {
        const rule = getEtaRule(leg?.transport_mode);
        totalHours += distanceKm / rule.speedKmh + rule.handlingHours;
        continue;
      }

      missingLegTransitData = true;
      break;
    }
  }

  if (missingLegTransitData) {
    const fallbackDistanceKm = toNumber(totalDistanceKm, Number.NaN);
    if (!Number.isFinite(fallbackDistanceKm) || fallbackDistanceKm <= 0) {
      return {
        hours: null,
        reason: 'MISSING_TRANSIT_DISTANCE'
      };
    }

    const dominantMode = pickDominantMode(legs);
    const rule = getEtaRule(dominantMode);
    totalHours = fallbackDistanceKm / rule.speedKmh + rule.handlingHours;
  }

  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return {
      hours: null,
      reason: 'MISSING_TRANSIT_DISTANCE'
    };
  }

  if (isCrossBorderShipment(originCountry, destinationCountry)) {
    totalHours += CROSS_BORDER_BUFFER_HOURS;
  }

  return {
    hours: totalHours,
    reason: null
  };
};

const buildShipmentSimulationState = ({
  createdAt,
  pendingUntil,
  originCountry,
  destinationCountry,
  legs = [],
  totalDistanceKm,
  simulationAllowed = true
}) => {
  if (!simulationAllowed) {
    return {
      simulation_enabled: false,
      pending_until: null,
      estimated_arrival_at: null,
      estimated_arrival: null,
      reason: 'SIMULATION_DISABLED'
    };
  }

  const createdAtDate = parseDate(createdAt) || new Date();
  const transit = calculateTransitHours({
    legs,
    totalDistanceKm,
    originCountry,
    destinationCountry
  });

  if (!transit.hours) {
    return {
      simulation_enabled: false,
      pending_until: null,
      estimated_arrival_at: null,
      estimated_arrival: null,
      reason: transit.reason
    };
  }

  const effectivePendingUntil = resolvePendingUntil(createdAtDate, pendingUntil);
  const effectiveTransitHours = Math.max(1, Math.ceil(transit.hours));
  const estimatedArrivalAt = allocateBusinessHours(
    effectivePendingUntil,
    effectiveTransitHours
  );

  return {
    simulation_enabled: true,
    pending_until: effectivePendingUntil,
    estimated_arrival_at: estimatedArrivalAt,
    estimated_arrival: toLegacyDate(estimatedArrivalAt),
    reason: null
  };
};

const resolveEffectiveShipmentStatus = (shipment, now = new Date()) => {
  if (!shipment) return 'pending';
  if (shipment.status === 'cancelled') return 'cancelled';
  if (shipment.status === 'delivered') return 'delivered';
  if (shipment.simulation_enabled !== true) return shipment.status;

  const nowDate = parseDate(now) || new Date();
  const pendingUntil = parseDate(shipment.pending_until);
  const estimatedArrivalAt = parseDate(shipment.estimated_arrival_at);

  if (!pendingUntil || !estimatedArrivalAt) {
    return shipment.status;
  }

  if (nowDate >= estimatedArrivalAt) {
    return 'delivered';
  }

  if (nowDate >= pendingUntil) {
    return 'in_transit';
  }

  return 'pending';
};

const shouldRebuildSimulationState = (shipment) => {
  if (shipment?.simulation_enabled === false) {
    return false;
  }

  const createdAtDate = normalizeToBusinessHour(shipment?.created_at) || parseDate(shipment?.created_at);
  const pendingUntil = parseDate(shipment?.pending_until);
  const estimatedArrivalAt = parseDate(shipment?.estimated_arrival_at);

  if (!pendingUntil || !estimatedArrivalAt) {
    return true;
  }

  if (!isBusinessHourDate(pendingUntil) || !isBusinessHourDate(estimatedArrivalAt)) {
    return true;
  }

  if (createdAtDate && pendingUntil.getTime() < createdAtDate.getTime()) {
    return true;
  }

  if (estimatedArrivalAt.getTime() <= pendingUntil.getTime()) {
    return true;
  }

  return String(shipment?.estimated_arrival || '') !== String(toLegacyDate(estimatedArrivalAt) || '');
};

const buildSimulationSyncMutation = (shipment, now = new Date()) => {
  const nextStatus = resolveEffectiveShipmentStatus(shipment, now);
  const currentActualArrivalAt = parseDate(shipment.actual_arrival_at);
  const nextActualArrivalAt =
    nextStatus === 'delivered' ?
      currentActualArrivalAt ||
      parseDate(shipment.estimated_arrival_at) ||
      parseDate(now) ||
      new Date() :
      currentActualArrivalAt;
  const nextActualArrival =
    nextStatus === 'delivered' ? toLegacyDate(nextActualArrivalAt) : shipment.actual_arrival;

  return {
    nextStatus,
    nextActualArrivalAt,
    nextActualArrival,
    hasChanges:
      shipment.status !== nextStatus ||
      String(currentActualArrivalAt?.toISOString() || '') !==
        String(nextActualArrivalAt?.toISOString() || '') ||
      String(shipment.actual_arrival || '') !== String(nextActualArrival || '')
  };
};

async function syncShipmentSimulationRecord(client, shipment, now = new Date()) {
  const mutation = buildSimulationSyncMutation(shipment, now);

  if (!mutation.hasChanges) {
    return shipment;
  }

  const updateResult = await client.query(
    `
      UPDATE shipments
      SET
        status = $1,
        actual_arrival_at = $2,
        actual_arrival = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING
        id,
        reference_number,
        status,
        simulation_enabled,
        pending_until,
        created_at,
        estimated_arrival_at,
        estimated_arrival,
        actual_arrival_at,
        actual_arrival,
        updated_at
    `,
    [
      mutation.nextStatus,
      mutation.nextStatus === 'delivered' ? mutation.nextActualArrivalAt : shipment.actual_arrival_at,
      mutation.nextStatus === 'delivered' ? mutation.nextActualArrival : shipment.actual_arrival,
      shipment.id
    ]
  );

  return updateResult.rows[0] || shipment;
}

async function ensureShipmentSimulationSchema() {
  assertSchemaCapability(
    'hasShipmentSimulationColumns',
    'Shipment simulation columns are missing. Run "npm run migrate" before starting the API.'
  );
  return true;
}

async function isDemoCompany(companyId) {
  if (!companyId) return false;

  if (demoCompanyCache.has(companyId)) {
    return demoCompanyCache.get(companyId);
  }

  const result = await pool.query(
    `
      SELECT
        c.name,
        EXISTS (
          SELECT 1
          FROM company_members cm
          INNER JOIN users u ON u.id = cm.user_id
          WHERE cm.company_id = c.id
            AND u.is_demo_user = true
        ) AS has_demo_member
      FROM companies c
      WHERE c.id = $1
    `,
    [companyId]
  );

  const row = result.rows[0];
  const isDemo =
    Boolean(row?.has_demo_member) ||
    String(row?.name || '').trim().toLowerCase() === 'demo company';

  demoCompanyCache.set(companyId, isDemo);
  return isDemo;
}

async function syncShipmentSimulationById(client, shipmentId) {
  const shipmentResult = await client.query(
    `
      SELECT
        id,
        reference_number,
        status,
        simulation_enabled,
        pending_until,
        created_at,
        estimated_arrival_at,
        estimated_arrival,
        actual_arrival_at,
        actual_arrival,
        updated_at
      FROM shipments
      WHERE id = $1
    `,
    [shipmentId]
  );

  if (shipmentResult.rows.length === 0) {
    return null;
  }

  return syncShipmentSimulationRecord(client, shipmentResult.rows[0]);
}

async function backfillCompanyShipments(companyId) {
  await ensureShipmentSimulationSchema();

  if (await isDemoCompany(companyId)) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const localPendingUntilSql =
      "((s.pending_until AT TIME ZONE 'UTC') + ($2 * INTERVAL '1 minute'))";
    const localEstimatedArrivalSql =
      "((s.estimated_arrival_at AT TIME ZONE 'UTC') + ($2 * INTERVAL '1 minute'))";
    const localActualArrivalSql =
      "((s.actual_arrival_at AT TIME ZONE 'UTC') + ($2 * INTERVAL '1 minute'))";

    const shipmentsResult = await client.query(
      `
        SELECT
          s.id,
          s.status,
          s.created_at,
          s.updated_at,
          s.origin_country,
          s.destination_country,
          s.total_distance_km,
          s.pending_until,
          s.estimated_arrival_at,
          s.actual_arrival_at,
          s.simulation_enabled,
          s.estimated_arrival,
          s.actual_arrival
        FROM shipments s
        WHERE s.company_id = $1
          AND (
            (
              s.simulation_enabled IS DISTINCT FROM false
              AND (s.pending_until IS NULL OR s.estimated_arrival_at IS NULL)
            )
            OR (
              s.simulation_enabled IS DISTINCT FROM false
              AND s.pending_until IS NOT NULL
              AND (
                DATE_TRUNC('hour', ${localPendingUntilSql}) <> ${localPendingUntilSql}
                OR EXTRACT(HOUR FROM ${localPendingUntilSql}) < $3
                OR EXTRACT(HOUR FROM ${localPendingUntilSql}) > $4
                OR s.pending_until < s.created_at
              )
            )
            OR (
              s.simulation_enabled IS DISTINCT FROM false
              AND s.estimated_arrival_at IS NOT NULL
              AND (
                DATE_TRUNC('hour', ${localEstimatedArrivalSql}) <> ${localEstimatedArrivalSql}
                OR EXTRACT(HOUR FROM ${localEstimatedArrivalSql}) < $3
                OR EXTRACT(HOUR FROM ${localEstimatedArrivalSql}) > $4
                OR (s.pending_until IS NOT NULL AND s.estimated_arrival_at <= s.pending_until)
              )
            )
            OR (s.status = 'delivered' AND s.actual_arrival_at IS NULL)
            OR (
              s.estimated_arrival_at IS NOT NULL
              AND s.estimated_arrival IS DISTINCT FROM (${localEstimatedArrivalSql})::date
            )
            OR (
              s.actual_arrival_at IS NOT NULL
              AND s.actual_arrival IS DISTINCT FROM (${localActualArrivalSql})::date
            )
          )
        ORDER BY s.created_at ASC
      `,
      [
        companyId,
        SIMULATION_UTC_OFFSET_MINUTES,
        BUSINESS_START_HOUR,
        BUSINESS_END_HOUR
      ]
    );

    if (shipmentsResult.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const shipmentIds = shipmentsResult.rows.map((shipment) => shipment.id);
    const legsResult = await client.query(
      `
        SELECT
          shipment_id,
          leg_order,
          transport_mode,
          distance_km,
          duration_hours
        FROM shipment_legs
        WHERE shipment_id = ANY($1)
        ORDER BY shipment_id ASC, leg_order ASC
      `,
      [shipmentIds]
    );

    const legsByShipmentId = new Map();
    for (const leg of legsResult.rows) {
      const current = legsByShipmentId.get(leg.shipment_id) || [];
      current.push(leg);
      legsByShipmentId.set(leg.shipment_id, current);
    }

    for (const shipment of shipmentsResult.rows) {
      const currentPendingUntil = parseDate(shipment.pending_until);
      const currentEstimatedArrivalAt = parseDate(shipment.estimated_arrival_at);
      const currentActualArrivalAt = parseDate(shipment.actual_arrival_at);
      const legs = legsByShipmentId.get(shipment.id) || [];

      let nextSimulationEnabled = shipment.simulation_enabled !== false;
      let nextPendingUntil = currentPendingUntil;
      let nextEstimatedArrivalAt = currentEstimatedArrivalAt;
      let nextEstimatedArrival = shipment.estimated_arrival;

      if (shouldRebuildSimulationState(shipment)) {
        const simulation = buildShipmentSimulationState({
          createdAt: shipment.created_at,
          pendingUntil: currentPendingUntil,
          originCountry: shipment.origin_country,
          destinationCountry: shipment.destination_country,
          legs,
          totalDistanceKm: shipment.total_distance_km,
          simulationAllowed: true
        });

        nextSimulationEnabled = simulation.simulation_enabled;
        nextPendingUntil =
          simulation.simulation_enabled ? simulation.pending_until : currentPendingUntil;
        nextEstimatedArrivalAt =
          simulation.simulation_enabled ?
            simulation.estimated_arrival_at :
            currentEstimatedArrivalAt;
        nextEstimatedArrival =
          simulation.simulation_enabled ? simulation.estimated_arrival : shipment.estimated_arrival;
      }

      if (nextEstimatedArrivalAt) {
        nextEstimatedArrival = toLegacyDate(nextEstimatedArrivalAt);
      } else if (!nextSimulationEnabled) {
        nextEstimatedArrival = shipment.estimated_arrival || null;
      }

      let nextActualArrivalAt = currentActualArrivalAt;
      let nextActualArrival = shipment.actual_arrival;

      if (shipment.status === 'delivered') {
        nextActualArrivalAt =
          currentActualArrivalAt ||
          parseDate(shipment.actual_arrival) ||
          nextEstimatedArrivalAt ||
          parseDate(shipment.updated_at) ||
          parseDate(shipment.created_at);
        nextActualArrival = toLegacyDate(nextActualArrivalAt);
      } else if (currentActualArrivalAt) {
        nextActualArrival = toLegacyDate(currentActualArrivalAt);
      }

      const estimatedChanged =
        String(currentEstimatedArrivalAt?.toISOString() || '') !==
          String(nextEstimatedArrivalAt?.toISOString() || '') ||
        String(shipment.estimated_arrival || '') !== String(nextEstimatedArrival || '');
      const actualChanged =
        String(currentActualArrivalAt?.toISOString() || '') !==
          String(nextActualArrivalAt?.toISOString() || '') ||
        String(shipment.actual_arrival || '') !== String(nextActualArrival || '');
      const simulationChanged = shipment.simulation_enabled !== nextSimulationEnabled;
      const pendingChanged =
        String(currentPendingUntil?.toISOString() || '') !==
        String(nextPendingUntil?.toISOString() || '');

      if (
        !estimatedChanged &&
        !actualChanged &&
        !simulationChanged &&
        !pendingChanged
      ) {
        continue;
      }

      await client.query(
        `
          UPDATE shipments
          SET
            simulation_enabled = $1,
            pending_until = $2,
            estimated_arrival_at = $3,
            estimated_arrival = $4,
            actual_arrival_at = $5,
            actual_arrival = $6,
            updated_at = NOW()
          WHERE id = $7
        `,
        [
          nextSimulationEnabled,
          nextPendingUntil,
          nextEstimatedArrivalAt,
          nextEstimatedArrival,
          nextActualArrivalAt,
          nextActualArrival,
          shipment.id
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncCompanyShipmentSimulation(companyId) {
  await ensureShipmentSimulationSchema();

  if (await isDemoCompany(companyId)) {
    return;
  }

  await backfillCompanyShipments(companyId);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const shipmentsResult = await client.query(
      `
        SELECT
          id,
          status,
          simulation_enabled,
          pending_until,
          estimated_arrival_at,
          actual_arrival_at,
          actual_arrival
        FROM shipments
        WHERE company_id = $1
          AND simulation_enabled = true
          AND status <> 'cancelled'
      `,
      [companyId]
    );

    const now = new Date();
    for (const shipment of shipmentsResult.rows) {
      await syncShipmentSimulationRecord(client, shipment, now);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  buildShipmentSimulationState,
  createBusinessError,
  ensureShipmentSimulationSchema,
  isDemoCompany,
  resolveEffectiveShipmentStatus,
  syncCompanyShipmentSimulation,
  syncShipmentSimulationById,
  toLegacyDate
};
