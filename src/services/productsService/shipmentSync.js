const logger = require('../../utils/logger');
const {
    buildShipmentSimulationState,
    syncShipmentSimulationById
} = require('../shipmentSimulationService');
const { toNumber, toPositiveInt } = require('./shared');

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

const DEFAULT_EMISSION_FACTOR_BY_MODE = {
    road: 0.12226,
    sea: 0.01612,
    air: 0.89939,
    rail: 0.02779
};

const normalizeTransportMode = (value) => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return TRANSPORT_MODE_ALIASES[raw] || 'road';
};

const toLocationAddressString = (location = {}) => {
    const pieces = [
        location.address,
        [location.streetNumber, location.street].filter(Boolean).join(' ').trim(),
        location.ward,
        location.district
    ]
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);

    return pieces.length > 0 ? pieces.join(', ') : null;
};

const toLocationCity = (location = {}) => {
    const city = typeof location.city === 'string' ? location.city.trim() : '';
    if (city) return city;
    const state = typeof location.stateRegion === 'string' ? location.stateRegion.trim() : '';
    return state || null;
};

const toLocationCountry = (location = {}) => {
    const country = typeof location.country === 'string' ? location.country.trim() : '';
    return country || null;
};

const toLocationLabel = (location = {}) => (
    toLocationCity(location) ||
    toLocationAddressString(location) ||
    toLocationCountry(location) ||
    'Unknown'
);

const extractLogisticsFromPayload = (payload = {}) => {
    let origin = null;
    let destination = null;
    let transportLegs = [];
    let estimatedArrival = null;

    if (payload?.step4_logistics) {
        origin = payload.step4_logistics.origin;
        destination = payload.step4_logistics.destination;
        transportLegs = payload.step4_logistics.transport_legs || payload.step4_logistics.transportLegs || [];
        estimatedArrival = payload.step4_logistics.estimated_arrival || payload.step4_logistics.estimatedArrival || null;
    } else if (payload?.originAddress && payload?.destinationAddress) {
        origin = payload.originAddress;
        destination = payload.destinationAddress;
        transportLegs = payload.transportLegs || payload.transport_legs || [];
        estimatedArrival = payload.estimatedArrival || payload.estimated_arrival || null;
    } else if (payload?.logistics) {
        origin = payload.logistics.origin;
        destination = payload.logistics.destination;
        transportLegs = payload.logistics.transport_legs || payload.logistics.transportLegs || [];
        estimatedArrival = payload.logistics.estimated_arrival || payload.logistics.estimatedArrival || null;
    }

    return {
        origin,
        destination,
        transportLegs: Array.isArray(transportLegs) ? transportLegs : [],
        estimatedArrival
    };
};

const resolveShipmentTransportCo2e = (product = {}) => {
    const payload = product?.payload || {};
    const quantity = toPositiveInt(payload?.quantity, 1);
    const carbonResults = payload.carbonResults || payload.carbon_results || {};
    const totalBatch = carbonResults.totalBatch || carbonResults.total_batch || {};
    const perProduct = carbonResults.perProduct || carbonResults.per_product || {};

    const batchTransportCo2e = toNumber(
        totalBatch.transport ?? totalBatch.transport_co2e,
        Number.NaN
    );
    if (Number.isFinite(batchTransportCo2e) && batchTransportCo2e > 0) {
        return batchTransportCo2e;
    }

    const perProductTransportCo2e = toNumber(
        product.transport_co2e ??
        product.transportCo2e ??
        perProduct.transport ??
        perProduct.transport_co2e,
        Number.NaN
    );
    if (Number.isFinite(perProductTransportCo2e) && perProductTransportCo2e > 0) {
        return perProductTransportCo2e * quantity;
    }

    return 0;
};

const normalizeShipmentLegs = (rawLegs, origin, destination, fallbackTotalCo2e, totalWeightKg = 0) => {
    const legs = Array.isArray(rawLegs) ? rawLegs : [];
    if (legs.length === 0) {
        return [];
    }

    const originLabel = toLocationLabel(origin);
    const destinationLabel = toLocationLabel(destination);

    const normalized = legs.map((rawLeg, index) => {
        const mode = normalizeTransportMode(
            rawLeg?.transport_mode ||
            rawLeg?.transportMode ||
            rawLeg?.mode ||
            rawLeg?.vehicle_type ||
            rawLeg?.vehicleType ||
            rawLeg?.type
        );

        const distanceKm = Math.max(
            0,
            toNumber(
                rawLeg?.distance_km ??
                rawLeg?.distanceKm ??
                rawLeg?.estimatedDistance ??
                rawLeg?.estimated_distance ??
                rawLeg?.distance ??
                rawLeg?.km,
                0
            )
        );

        const defaultFactor = DEFAULT_EMISSION_FACTOR_BY_MODE[mode] || DEFAULT_EMISSION_FACTOR_BY_MODE.road;
        const emissionFactorUsed = Math.max(
            0,
            toNumber(
                rawLeg?.emission_factor_used ??
                rawLeg?.emission_factor ??
                rawLeg?.emissionFactor,
                defaultFactor
            )
        );

        const parsedCo2 = toNumber(
            rawLeg?.co2e ??
            rawLeg?.co2_kg ??
            rawLeg?.co2 ??
            rawLeg?.emission_kg,
            Number.NaN
        );

        let co2e = Number.isFinite(parsedCo2) && parsedCo2 >= 0 ? parsedCo2 : null;
        if (co2e === null && distanceKm > 0 && emissionFactorUsed > 0) {
            co2e = distanceKm * emissionFactorUsed;
        }

        const fallbackOriginLocation = index === 0 ? originLabel : `Transit ${index}`;
        const fallbackDestinationLocation = index === legs.length - 1 ? destinationLabel : `Transit ${index + 1}`;

        return {
            leg_order: index + 1,
            transport_mode: mode,
            origin_location:
                (rawLeg?.origin_location || rawLeg?.originLocation || rawLeg?.origin?.name || '').trim() || fallbackOriginLocation,
            destination_location:
                (rawLeg?.destination_location || rawLeg?.destinationLocation || rawLeg?.destination?.name || '').trim() || fallbackDestinationLocation,
            distance_km: distanceKm,
            duration_hours: Math.max(
                0,
                toNumber(rawLeg?.duration_hours ?? rawLeg?.durationHours, 0)
            ),
            co2e,
            emission_factor_used: emissionFactorUsed,
            carrier_name: rawLeg?.carrier_name || rawLeg?.carrierName || null,
            vehicle_type: rawLeg?.vehicle_type || rawLeg?.vehicleType || mode
        };
    });

    const knownCo2e = normalized.reduce((sum, leg) => sum + (leg.co2e !== null ? leg.co2e : 0), 0);
    const missingIndexes = normalized
        .map((leg, index) => ({ leg, index }))
        .filter((entry) => entry.leg.co2e === null)
        .map((entry) => entry.index);

    if (missingIndexes.length > 0) {
        const remainingCo2e = Math.max(0, fallbackTotalCo2e - knownCo2e);
        const missingDistanceWeight = missingIndexes.reduce((sum, index) => {
            const legDistance = normalized[index].distance_km;
            return sum + (legDistance > 0 ? legDistance : 1);
        }, 0);

        missingIndexes.forEach((index) => {
            const legDistance = normalized[index].distance_km;
            const weight = legDistance > 0 ? legDistance : 1;

            if (remainingCo2e > 0 && missingDistanceWeight > 0) {
                normalized[index].co2e = remainingCo2e * (weight / missingDistanceWeight);
                return;
            }

            normalized[index].co2e = legDistance * normalized[index].emission_factor_used;
            if (totalWeightKg > 0) {
                normalized[index].co2e *= totalWeightKg / 1000;
            }
        });
    }

    return normalized.map((leg) => ({
        ...leg,
        distance_km: Math.max(0, toNumber(leg.distance_km, 0)),
        co2e: Math.max(0, toNumber(leg.co2e, 0)),
        emission_factor_used: Math.max(
            0,
            toNumber(
                leg.emission_factor_used,
                DEFAULT_EMISSION_FACTOR_BY_MODE[leg.transport_mode] || DEFAULT_EMISSION_FACTOR_BY_MODE.road
            )
        )
    }));
};

const toEstimatedArrivalDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const raw = String(value).trim();
        return raw.length > 0 ? raw : null;
    }
    return parsed.toISOString().slice(0, 10);
};

async function syncShipmentFromProduct(client, productId, companyId, product, options = {}) {
    const payload = product?.payload || {};
    const { origin, destination, transportLegs, estimatedArrival } = extractLogisticsFromPayload(payload);

    if (!origin || !destination) {
        return {
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'MISSING_LOGISTICS_DATA'
        };
    }

    if (!origin?.country || !destination?.country) {
        return {
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'MISSING_LOCATION_COUNTRY'
        };
    }

    const quantity = toPositiveInt(payload?.quantity, 1);
    const unitWeightKg = Math.max(0, toNumber(product.weight_kg, 0));
    const totalWeightKg = unitWeightKg > 0 ? unitWeightKg * quantity : unitWeightKg;
    const fallbackTotalCo2e = Math.max(0, resolveShipmentTransportCo2e(product));
    const normalizedLegs = normalizeShipmentLegs(
        transportLegs,
        origin,
        destination,
        fallbackTotalCo2e,
        totalWeightKg
    );
    if (normalizedLegs.length === 0) {
        return {
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'MISSING_TRANSPORT_LEGS'
        };
    }
    const totalDistanceKm = normalizedLegs.reduce((sum, leg) => sum + leg.distance_km, 0);
    const totalCo2e = normalizedLegs.reduce((sum, leg) => sum + leg.co2e, 0) || fallbackTotalCo2e;

    const linkedShipmentResult = await client.query(
        `SELECT s.id, s.reference_number, s.created_at, s.pending_until
         FROM shipments s
         INNER JOIN shipment_products sp ON sp.shipment_id = s.id
         WHERE s.company_id = $1 AND sp.product_id = $2
         ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
         LIMIT 1`,
        [companyId, productId]
    );

    if (linkedShipmentResult.rows.length === 0) {
        return createShipmentFromProduct(client, productId, companyId, product, options);
    }

    const linkedShipment = linkedShipmentResult.rows[0];
    const shipmentId = linkedShipment.id;
    const productCountResult = await client.query(
        'SELECT COUNT(*)::int AS count FROM shipment_products WHERE shipment_id = $1',
        [shipmentId]
    );
    const productCount = Number.parseInt(productCountResult.rows[0]?.count, 10) || 0;

    if (productCount > 1) {
        return {
            shipmentId,
            shipmentReferenceNumber: linkedShipment.reference_number || null,
            shipmentCreationSkipped: true,
            skipReason: 'SHIPMENT_HAS_MULTIPLE_PRODUCTS'
        };
    }

    const simulation = buildShipmentSimulationState({
        createdAt: linkedShipment.created_at,
        pendingUntil: linkedShipment.pending_until,
        originCountry: origin.country,
        destinationCountry: destination.country,
        legs: normalizedLegs,
        totalDistanceKm,
        simulationAllowed: !options.isDemoUser
    });
    const legacyEstimatedArrival =
        simulation.simulation_enabled ?
        simulation.estimated_arrival :
        toEstimatedArrivalDate(estimatedArrival);

    await client.query(
        `UPDATE shipments
         SET
            origin_country = $1,
            origin_city = $2,
            origin_address = $3,
            origin_lat = $4,
            origin_lng = $5,
            destination_country = $6,
            destination_city = $7,
            destination_address = $8,
            destination_lat = $9,
            destination_lng = $10,
            total_weight_kg = $11,
            total_distance_km = $12,
            total_co2e = $13,
            pending_until = $14,
            estimated_arrival = $15,
            estimated_arrival_at = $16,
            simulation_enabled = $17,
            updated_at = NOW()
         WHERE id = $18`,
        [
            origin.country,
            toLocationCity(origin),
            toLocationAddressString(origin),
            origin.lat || null,
            origin.lng || null,
            destination.country,
            toLocationCity(destination),
            toLocationAddressString(destination),
            destination.lat || null,
            destination.lng || null,
            totalWeightKg,
            totalDistanceKm,
            totalCo2e,
            simulation.pending_until,
            legacyEstimatedArrival,
            simulation.estimated_arrival_at,
            simulation.simulation_enabled,
            shipmentId
        ]
    );

    await client.query('DELETE FROM shipment_legs WHERE shipment_id = $1', [shipmentId]);

    for (const leg of normalizedLegs) {
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
                leg.duration_hours || null,
                leg.co2e,
                leg.emission_factor_used || null,
                leg.carrier_name || null,
                leg.vehicle_type || null
            ]
        );
    }

    const updateLinkResult = await client.query(
        `UPDATE shipment_products
         SET quantity = $1, weight_kg = $2, allocated_co2e = $3
         WHERE shipment_id = $4 AND product_id = $5`,
        [quantity, totalWeightKg, totalCo2e, shipmentId, productId]
    );

    if (updateLinkResult.rowCount === 0) {
        await client.query(
            `INSERT INTO shipment_products (
                shipment_id,
                product_id,
                quantity,
                weight_kg,
                allocated_co2e
            ) VALUES ($1, $2, $3, $4, $5)`,
            [shipmentId, productId, quantity, totalWeightKg, totalCo2e]
        );
    }

    if (simulation.simulation_enabled) {
        await syncShipmentSimulationById(client, shipmentId);
    }

    return {
        shipmentId,
        shipmentReferenceNumber: linkedShipment.reference_number || null,
        shipmentCreationSkipped: false,
        skipReason: null
    };
}

/**
 * Create shipment from product logistics data (internal helper)
 */
async function createShipmentFromProduct(client, productId, companyId, product, options = {}) {
    try {
        const payload = product?.payload || {};
        const { origin, destination, transportLegs, estimatedArrival } = extractLogisticsFromPayload(payload);

        if (!origin || !destination) {
            return {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: true,
                skipReason: 'MISSING_LOGISTICS_DATA'
            };
        }

        // Require at least origin and destination country
        if (!origin?.country || !destination?.country) {
            return {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: true,
                skipReason: 'MISSING_LOCATION_COUNTRY'
            };
        }

        // Generate reference number
        const countResult = await client.query(
            'SELECT COUNT(*) as count FROM shipments WHERE company_id = $1',
            [companyId]
        );
        const count = parseInt(countResult.rows[0].count) + 1;
        const refNumber = `SHIP-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;

        // Calculate totals from transport legs
        const quantity = toPositiveInt(payload?.quantity, 1);
        const unitWeightKg = Math.max(0, toNumber(product.weight_kg, 0));
        const totalWeightKg = unitWeightKg > 0 ? unitWeightKg * quantity : unitWeightKg;
        const fallbackTotalCo2e = Math.max(0, resolveShipmentTransportCo2e(product));
        const legs = normalizeShipmentLegs(
            transportLegs,
            origin,
            destination,
            fallbackTotalCo2e,
            totalWeightKg
        );
        if (legs.length === 0) {
            return {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: true,
                skipReason: 'MISSING_TRANSPORT_LEGS'
            };
        }
        const totalDistanceKm = legs.reduce((sum, leg) => sum + leg.distance_km, 0);
        const totalCo2e = legs.reduce((sum, leg) => sum + leg.co2e, 0) || fallbackTotalCo2e;

        const createdAt = new Date();
        const simulation = buildShipmentSimulationState({
            createdAt,
            originCountry: origin.country,
            destinationCountry: destination.country,
            legs,
            totalDistanceKm,
            simulationAllowed: !options.isDemoUser
        });
        const legacyEstimatedArrival =
            simulation.simulation_enabled ?
            simulation.estimated_arrival :
            toEstimatedArrivalDate(estimatedArrival);

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
            RETURNING id
        `;

        const shipmentResult = await client.query(shipmentQuery, [
            companyId,
            refNumber,
            'pending',
            origin.country,
            toLocationCity(origin),
            toLocationAddressString(origin),
            origin.lat || null,
            origin.lng || null,
            destination.country,
            toLocationCity(destination),
            toLocationAddressString(destination),
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
        ]);

        const shipmentId = shipmentResult.rows[0].id;

        // Insert legs if provided
        if (legs.length > 0) {
            for (let i = 0; i < legs.length; i++) {
                const leg = legs[i];
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
                        leg.duration_hours || null,
                        leg.co2e,
                        leg.emission_factor_used || null,
                        leg.carrier_name || null,
                        leg.vehicle_type || null
                    ]
                );
            }
        }

        // Link product to shipment
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
                productId,
                quantity,
                totalWeightKg,
                totalCo2e
            ]
        );

        return {
            shipmentId,
            shipmentReferenceNumber: refNumber,
            shipmentCreationSkipped: false,
            skipReason: null
        };
    } catch (error) {
        logger.error({ err: error }, `Error creating shipment from product ${productId}`);
        // Don't fail the whole transaction, just log and continue
        return {
            shipmentId: null,
            shipmentReferenceNumber: null,
            shipmentCreationSkipped: true,
            skipReason: 'SHIPMENT_CREATE_ERROR'
        };
    }
}

module.exports = {
    normalizeTransportMode,
    toLocationAddressString,
    toLocationCity,
    toLocationCountry,
    toLocationLabel,
    extractLogisticsFromPayload,
    resolveShipmentTransportCo2e,
    normalizeShipmentLegs,
    toEstimatedArrivalDate,
    syncShipmentFromProduct,
    createShipmentFromProduct
};
