const pool = require('../config/database');
const domesticComplianceService = require('./domesticComplianceService');
const {
    buildShipmentSimulationState,
    ensureShipmentSimulationSchema,
    syncShipmentSimulationById
} = require('./shipmentSimulationService');

/**
 * Status mapping helper
 * DB: draft, active, archived
 * FE: draft, published, archived
 */
const dbToFeStatus = (dbStatus) => {
    if (dbStatus === 'active') return 'published';
    return dbStatus; // draft, archived stay the same
};

const feToDbStatus = (feStatus) => {
    if (feStatus === 'published') return 'active';
    return feStatus; // draft, archived stay the same
};

/**
 * Confidence level mapping from score
 */
const getConfidenceLevel = (score) => {
    if (score >= 85) return 'high';
    if (score >= 65) return 'medium';
    return 'low';
};

const clampConfidenceScore = (score) => {
    const parsed = Number.parseFloat(score);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
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

const DEFAULT_EMISSION_FACTOR_BY_MODE = {
    road: 0.105,
    sea: 0.016,
    air: 0.602,
    rail: 0.028
};

const buildDomesticComplianceWarning = (validationResult) => ({
    code: 'MISSING_DOMESTIC_DOCUMENTS',
    message: 'Published with missing required domestic documents.',
    details: {
        market_code: validationResult?.marketCode || 'VN',
        required_documents: validationResult?.requiredDocuments || [],
        missing_by_product: validationResult?.missingByProduct || []
    }
});

class ProductsService {
    /**
     * List products with filters and pagination
     */
    async listProducts(companyId, filters = {}) {
        const {
            search,
            status,
            category,
            page = 1,
            page_size = 20,
            sort_by = 'updated_at',
            sort_order = 'desc',
            include
        } = filters;

        const client = await pool.connect();
        try {
            const conditions = ['p.company_id = $1'];
            const params = [companyId];
            let paramIndex = 2;

            if (search) {
                conditions.push(`(p.sku ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (status && status !== 'all') {
                const dbStatus = feToDbStatus(status);
                conditions.push(`p.status = $${paramIndex}`);
                params.push(dbStatus);
                paramIndex++;
            } else {
                conditions.push(`p.status <> 'archived'`);
            }

            // Category filter
            if (category) {
                conditions.push(`p.category = $${paramIndex}`);
                params.push(category);
                paramIndex++;
            }

            const whereClause = conditions.join(' AND ');
            const countQuery = `SELECT COUNT(*) as total FROM products p WHERE ${whereClause}`;
            const countResult = await client.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            const offset = (page - 1) * page_size;
            const totalPages = Math.ceil(total / page_size);

            const allowedSortFields = {
                'created_at': 'p.created_at',
                'updated_at': 'p.updated_at',
                'name': 'p.name',
                'sku': 'p.sku',
                'total_co2e': 'p.total_co2e'
            };
            const sortField = allowedSortFields[sort_by] || 'p.updated_at';
            const orderDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

            const productsQuery = `
                SELECT 
                    p.id,
                    p.sku,
                    p.name,
                    p.category,
                    p.weight_kg,
                    p.status,
                    p.total_co2e,
                    p.materials_co2e,
                    p.production_co2e,
                    p.transport_co2e,
                    p.packaging_co2e,
                    p.data_confidence_score,
                    p.created_at,
                    p.updated_at,
                    c.target_markets
                FROM products p
                LEFT JOIN companies c ON p.company_id = c.id
                WHERE ${whereClause}
                ORDER BY ${sortField} ${orderDirection}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            params.push(page_size, offset);

            const productsResult = await client.query(productsQuery, params);
            const productIds = productsResult.rows.map(r => r.id);
            const snapshotsMap = {};
            const latestShipmentMap = {};

            if (productIds.length > 0) {
                const snapshotsQuery = `
                    SELECT product_id, payload
                    FROM product_assessment_snapshots
                    WHERE product_id = ANY($1)
                `;
                const snapshotsResult = await client.query(snapshotsQuery, [productIds]);
                snapshotsResult.rows.forEach(row => {
                    snapshotsMap[row.product_id] = row.payload;
                });

                const latestShipmentQuery = `
                    SELECT DISTINCT ON (sp.product_id)
                        sp.product_id,
                        sp.shipment_id,
                        s.reference_number
                    FROM shipment_products sp
                    INNER JOIN shipments s ON s.id = sp.shipment_id
                    WHERE sp.product_id = ANY($1::uuid[])
                      AND s.company_id = $2
                    ORDER BY
                        sp.product_id,
                        s.updated_at DESC NULLS LAST,
                        s.created_at DESC NULLS LAST
                `;
                const latestShipmentResult = await client.query(latestShipmentQuery, [productIds, companyId]);
                latestShipmentResult.rows.forEach((row) => {
                    latestShipmentMap[row.product_id] = {
                        shipmentId: row.shipment_id,
                        referenceNumber: row.reference_number
                    };
                });
            }

            const items = productsResult.rows.map(row => {
                const latestShipment = latestShipmentMap[row.id] || null;
                const snapshot = this._toPayloadObject(snapshotsMap[row.id]);
                const destinationMarket = this._extractDestinationMarketFromPayload(
                    snapshot,
                    row.target_markets
                );
                const snapshotLogistics = this._toPayloadObject(snapshot.logistics);
                const snapshotStep4 = this._toPayloadObject(snapshot.step4_logistics);
                const transportLegs = Array.isArray(snapshot.transportLegs)
                    ? snapshot.transportLegs
                    : Array.isArray(snapshot.transport_legs)
                    ? snapshot.transport_legs
                    : Array.isArray(snapshotStep4.transportLegs)
                    ? snapshotStep4.transportLegs
                    : Array.isArray(snapshotStep4.transport_legs)
                    ? snapshotStep4.transport_legs
                    : Array.isArray(snapshotLogistics.transportLegs)
                    ? snapshotLogistics.transportLegs
                    : Array.isArray(snapshotLogistics.transport_legs)
                    ? snapshotLogistics.transport_legs
                    : [];
                const confidenceScore = (() => {
                    const computed = this._computeDataConfidenceScore(snapshot);
                    if (computed > 0) return computed;
                    return clampConfidenceScore(row.data_confidence_score);
                })();

                return {
                    id: row.id,
                    productCode: row.sku,
                    productName: row.name,
                    productType: row.category,
                    weightPerUnit: row.weight_kg ? row.weight_kg * 1000 : null, // kg to grams
                    quantity: snapshot.quantity || null,
                    status: dbToFeStatus(row.status), // Always map: active -> published
                    materials: snapshot.materials || [],
                    // Logistics fields (required for ShippingOverviewMap, TrackShipment)
                    originAddress: snapshot.originAddress || snapshot.origin_address || snapshotStep4.origin || snapshotLogistics.origin || null,
                    destinationAddress: snapshot.destinationAddress || snapshot.destination_address || snapshotStep4.destination || snapshotLogistics.destination || null,
                    destinationMarket,
                    transportLegs,
                    estimatedTotalDistance:
                        snapshot.estimatedTotalDistance ||
                        snapshot.estimated_total_distance ||
                        snapshot.totalDistanceKm ||
                        snapshot.total_distance_km ||
                        snapshotStep4.estimatedTotalDistance ||
                        snapshotStep4.estimated_total_distance ||
                        snapshotStep4.totalDistanceKm ||
                        snapshotStep4.total_distance_km ||
                        snapshotLogistics.estimatedTotalDistance ||
                        snapshotLogistics.estimated_total_distance ||
                        snapshotLogistics.totalDistanceKm ||
                        snapshotLogistics.total_distance_km ||
                        null,
                    shipmentId: snapshot.shipmentId || snapshot.shipment_id || latestShipment?.shipmentId || null,
                    shipmentReferenceNumber:
                        snapshot.shipmentReferenceNumber ||
                        snapshot.shipment_reference_number ||
                        latestShipment?.referenceNumber ||
                        null,
                    carbonResults: {
                        perProduct: {
                            materials: parseFloat(row.materials_co2e) || 0,
                            production: parseFloat(row.production_co2e) || 0,
                            energy: snapshot.carbonResults?.perProduct?.energy || 0,
                            transport: parseFloat(row.transport_co2e) || 0,
                            packaging: parseFloat(row.packaging_co2e) || 0,
                            total: parseFloat(row.total_co2e) || 0
                        },
                        totalBatch: snapshot.carbonResults?.totalBatch || {},
                        confidenceLevel: getConfidenceLevel(confidenceScore),
                        confidenceScore,
                        proxyUsed: snapshot.carbonResults?.proxyUsed || false,
                        proxyNotes: snapshot.carbonResults?.proxyNotes || [],
                        scope1: snapshot.carbonResults?.scope1 || 0,
                        scope2: snapshot.carbonResults?.scope2 || 0,
                        scope3: snapshot.carbonResults?.scope3 || 0
                    },
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };
            });

            return {
                items,
                pagination: {
                    page,
                    page_size,
                    total,
                    total_pages: totalPages
                }
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get product by ID (full assessment payload)
     */
    async getProductById(productId, companyId) {
        const client = await pool.connect();
        try {
            // Get product basic info
            const productQuery = `
                SELECT 
                    p.id,
                    p.sku,
                    p.name,
                    p.category,
                    p.weight_kg,
                    p.status,
                    p.total_co2e,
                    p.materials_co2e,
                    p.production_co2e,
                    p.transport_co2e,
                    p.packaging_co2e,
                    p.data_confidence_score,
                    p.created_at,
                    p.updated_at,
                    c.target_markets,
                    latest_shipment.shipment_id,
                    latest_shipment.reference_number AS shipment_reference_number
                FROM products p
                LEFT JOIN companies c ON p.company_id = c.id
                LEFT JOIN LATERAL (
                    SELECT
                        sp.shipment_id,
                        s.reference_number
                    FROM shipment_products sp
                    INNER JOIN shipments s ON s.id = sp.shipment_id
                    WHERE sp.product_id = p.id AND s.company_id = p.company_id
                    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
                    LIMIT 1
                ) latest_shipment ON true
                WHERE p.id = $1 AND p.company_id = $2
            `;
            const productResult = await client.query(productQuery, [productId, companyId]);

            if (productResult.rows.length === 0) {
                return null;
            }

            const product = productResult.rows[0];

            // Get snapshot with full payload
            const snapshotQuery = `
                SELECT version, payload
                FROM product_assessment_snapshots
                WHERE product_id = $1
                ORDER BY version DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            `;
            const snapshotResult = await client.query(snapshotQuery, [productId]);

            let payload = {};
            let version = 1;

            if (snapshotResult.rows.length > 0) {
                version = snapshotResult.rows[0].version;
                payload = this._toPayloadObject(snapshotResult.rows[0].payload);
            }
            const destinationMarket = this._extractDestinationMarketFromPayload(
                payload,
                product.target_markets
            );
            const confidenceScore = (() => {
                const computed = this._computeDataConfidenceScore(payload);
                if (computed > 0) return computed;
                return clampConfidenceScore(product.data_confidence_score);
            })();

            // Merge product data with snapshot payload
            return {
                id: product.id,
                productCode: product.sku,
                productName: product.name,
                productType: product.category,
                weightPerUnit: product.weight_kg ? product.weight_kg * 1000 : null,
                // Snapshot data
                ...payload,
                status: dbToFeStatus(product.status),
                version,
                createdAt: product.created_at,
                updatedAt: product.updated_at,
                destinationMarket,
                shipmentId: payload.shipmentId || payload.shipment_id || product.shipment_id || null,
                shipmentReferenceNumber:
                    payload.shipmentReferenceNumber ||
                    payload.shipment_reference_number ||
                    product.shipment_reference_number ||
                    null,
                // Override with latest DB carbon data
                carbonResults: {
                    ...(payload.carbonResults || {}),
                    perProduct: {
                        ...(payload.carbonResults?.perProduct || {}),
                        materials: parseFloat(product.materials_co2e) || 0,
                        production: parseFloat(product.production_co2e) || 0,
                        transport: parseFloat(product.transport_co2e) || 0,
                        packaging: parseFloat(product.packaging_co2e) || 0,
                        total: parseFloat(product.total_co2e) || 0
                    },
                    confidenceLevel: getConfidenceLevel(confidenceScore),
                    confidenceScore
                }
            };
        } finally {
            client.release();
        }
    }

    /**
     * Create new product
     */
    async createProduct(companyId, userId, productData) {
        await ensureShipmentSimulationSchema();
        const {
            productCode,
            productName,
            productType,
            weightPerUnit,
            quantity,
            carbonResults,
            save_mode = 'draft',
            ...snapshotPayload
        } = productData;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const isDemoUser = await this._isDemoUser(client, userId);

            // Check duplicate SKU
            const checkQuery = `
                SELECT id FROM products
                WHERE company_id = $1 AND sku = $2
            `;
            const checkResult = await client.query(checkQuery, [companyId, productCode]);

            if (checkResult.rows.length > 0) {
                throw { code: 'DUPLICATE_SKU', message: 'Product code already exists' };
            }

            // Determine status
            const dbStatus = save_mode === 'publish' ? 'active' : 'draft';

            // Insert product
            const insertQuery = `
                INSERT INTO products (
                    company_id,
                    sku,
                    name,
                    category,
                    weight_kg,
                    status,
                    total_co2e,
                    materials_co2e,
                    production_co2e,
                    transport_co2e,
                    packaging_co2e,
                    data_confidence_score
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id, status, created_at
            `;

            const weightKg = weightPerUnit ? weightPerUnit / 1000 : null;
            const payloadWithoutCarbonResults = {
                quantity,
                ...snapshotPayload
            };
            const computedConfidenceScore = this._computeDataConfidenceScore({
                ...payloadWithoutCarbonResults,
                carbonResults
            });
            const normalizedCarbonResults = this._buildCarbonResultsWithConfidence(
                carbonResults,
                computedConfidenceScore
            );
            const totalCo2e = normalizedCarbonResults?.perProduct?.total || 0;
            const materialsCo2e = normalizedCarbonResults?.perProduct?.materials || 0;
            const productionCo2e = normalizedCarbonResults?.perProduct?.production || 0;
            const transportCo2e = normalizedCarbonResults?.perProduct?.transport || 0;
            const packagingCo2e = normalizedCarbonResults?.perProduct?.packaging || 0;

            const insertResult = await client.query(insertQuery, [
                companyId,
                productCode,
                productName,
                productType || null,
                weightKg,
                dbStatus,
                totalCo2e,
                materialsCo2e,
                productionCo2e,
                transportCo2e,
                packagingCo2e,
                computedConfidenceScore
            ]);

            const product = insertResult.rows[0];

            // Insert snapshot
            const snapshotInsertQuery = `
                INSERT INTO product_assessment_snapshots (
                    product_id,
                    version,
                    payload
                ) VALUES ($1, $2, $3)
            `;

            const fullPayload = {
                ...payloadWithoutCarbonResults,
                carbonResults: normalizedCarbonResults
            };

            await client.query(snapshotInsertQuery, [
                product.id,
                1,
                JSON.stringify(fullPayload)
            ]);

            // Auto-create shipment if publishing directly
            let shipmentMeta = {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: false,
                skipReason: null
            };
            let domesticComplianceWarning = null;

            if (dbStatus === 'active') {
                const domesticComplianceValidation =
                    await domesticComplianceService.validateProductsForDomesticPublish(
                        client,
                        companyId,
                        [product.id]
                    );

                if (!domesticComplianceValidation.success) {
                    domesticComplianceWarning = buildDomesticComplianceWarning(domesticComplianceValidation);
                }

                shipmentMeta = await this._createShipmentFromProduct(
                    client,
                    product.id,
                    companyId,
                    {
                        ...product,
                        weight_kg: weightKg,
                        total_co2e: totalCo2e,
                        payload: fullPayload
                    },
                    { isDemoUser }
                );
            }

            await client.query('COMMIT');

            return {
                id: product.id,
                status: dbToFeStatus(product.status),
                version: 1,
                shipmentId: shipmentMeta.shipmentId,
                shipmentReferenceNumber: shipmentMeta.shipmentReferenceNumber,
                shipmentCreationSkipped: shipmentMeta.shipmentCreationSkipped,
                skipReason: shipmentMeta.skipReason,
                domesticComplianceWarning
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update product
     */
    async updateProduct(productId, companyId, userId, productData) {
        await ensureShipmentSimulationSchema();
        const {
            productCode,
            productName,
            productType,
            weightPerUnit,
            quantity,
            carbonResults,
            ...snapshotPayload
        } = productData;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const isDemoUser = await this._isDemoUser(client, userId);

            // Check product exists
            const checkQuery = `
                SELECT id, status FROM products
                WHERE id = $1 AND company_id = $2
            `;
            const checkResult = await client.query(checkQuery, [productId, companyId]);

            if (checkResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            // Update product
            const updateQuery = `
                UPDATE products
                SET 
                    sku = $1,
                    name = $2,
                    category = $3,
                    weight_kg = $4,
                    total_co2e = $5,
                    materials_co2e = $6,
                    production_co2e = $7,
                    transport_co2e = $8,
                    packaging_co2e = $9,
                    data_confidence_score = $10,
                    updated_at = NOW()
                WHERE id = $11
                RETURNING status, updated_at
            `;

            const weightKg = weightPerUnit ? weightPerUnit / 1000 : null;
            const payloadWithoutCarbonResults = {
                quantity,
                ...snapshotPayload
            };
            const computedConfidenceScore = this._computeDataConfidenceScore({
                ...payloadWithoutCarbonResults,
                carbonResults
            });
            const normalizedCarbonResults = this._buildCarbonResultsWithConfidence(
                carbonResults,
                computedConfidenceScore
            );
            const totalCo2e = normalizedCarbonResults?.perProduct?.total || 0;
            const materialsCo2e = normalizedCarbonResults?.perProduct?.materials || 0;
            const productionCo2e = normalizedCarbonResults?.perProduct?.production || 0;
            const transportCo2e = normalizedCarbonResults?.perProduct?.transport || 0;
            const packagingCo2e = normalizedCarbonResults?.perProduct?.packaging || 0;

            const updateResult = await client.query(updateQuery, [
                productCode,
                productName,
                productType || null,
                weightKg,
                totalCo2e,
                materialsCo2e,
                productionCo2e,
                transportCo2e,
                packagingCo2e,
                computedConfidenceScore,
                productId
            ]);

            // Update snapshot (increment version)
            const snapshotUpdateQuery = `
                UPDATE product_assessment_snapshots
                SET 
                    version = version + 1,
                    payload = $1,
                    updated_at = NOW()
                WHERE product_id = $2
                RETURNING version
            `;

            const fullPayload = {
                ...payloadWithoutCarbonResults,
                carbonResults: normalizedCarbonResults
            };

            const snapshotResult = await client.query(snapshotUpdateQuery, [
                JSON.stringify(fullPayload),
                productId
            ]);

            let shipmentMeta = {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: false,
                skipReason: null
            };

            if (checkResult.rows[0].status === 'active') {
                shipmentMeta = await this._syncShipmentFromProduct(
                    client,
                    productId,
                    companyId,
                    {
                        id: productId,
                        weight_kg: weightKg,
                        total_co2e: totalCo2e,
                        payload: fullPayload
                    },
                    { isDemoUser }
                );
            }

            await client.query('COMMIT');

            const version = snapshotResult.rows.length > 0 ? snapshotResult.rows[0].version : 1;

            return {
                success: true,
                data: {
                    id: productId,
                    status: dbToFeStatus(updateResult.rows[0].status),
                    version,
                    updatedAt: updateResult.rows[0].updated_at,
                    shipmentId: shipmentMeta.shipmentId,
                    shipmentReferenceNumber: shipmentMeta.shipmentReferenceNumber,
                    shipmentCreationSkipped: shipmentMeta.shipmentCreationSkipped,
                    skipReason: shipmentMeta.skipReason
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update product status
     */
    async updateProductStatus(productId, companyId, userId, newStatus) {
        await ensureShipmentSimulationSchema();

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const isDemoUser = await this._isDemoUser(client, userId);

            // Get current status and product weight (with latest snapshot)
            const selectQuery = `
                SELECT p.id, p.status, p.weight_kg, p.total_co2e, s.payload
                FROM products p
                LEFT JOIN LATERAL (
                    SELECT payload
                    FROM product_assessment_snapshots ps
                    WHERE ps.product_id = p.id
                    ORDER BY ps.version DESC NULLS LAST, ps.updated_at DESC NULLS LAST, ps.created_at DESC
                    LIMIT 1
                ) s ON true
                WHERE p.id = $1 AND p.company_id = $2
            `;
            const selectResult = await client.query(selectQuery, [productId, companyId]);

            if (selectResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            const product = selectResult.rows[0];
            const currentStatus = dbToFeStatus(product.status);
            let domesticComplianceWarning = null;

            // Validate transitions
            const validTransitions = {
                'draft': ['published'],
                'published': ['archived'],
                'archived': ['draft']
            };

            if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(newStatus)) {
                return {
                    success: false,
                    error: 'INVALID_STATUS_TRANSITION',
                    message: `Cannot transition from ${currentStatus} to ${newStatus}`
                };
            }

            if (currentStatus === 'draft' && newStatus === 'published') {
                const domesticComplianceValidation =
                    await domesticComplianceService.validateProductsForDomesticPublish(
                        client,
                        companyId,
                        [productId]
                    );

                if (!domesticComplianceValidation.success) {
                    domesticComplianceWarning = buildDomesticComplianceWarning(domesticComplianceValidation);
                }
            }

            // Update status
            const dbNewStatus = feToDbStatus(newStatus);
            const updateQuery = `
                UPDATE products
                SET status = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING status, updated_at
            `;

            const updateResult = await client.query(updateQuery, [dbNewStatus, productId]);

            // Auto-create shipment when publishing product
            let shipmentMeta = {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: false,
                skipReason: null
            };

            if (currentStatus === 'draft' && newStatus === 'published' && product.payload) {
                shipmentMeta = await this._createShipmentFromProduct(
                    client,
                    productId,
                    companyId,
                    product,
                    { isDemoUser }
                );
            }

            await client.query('COMMIT');

            return {
                success: true,
                data: {
                    id: productId,
                    status: dbToFeStatus(updateResult.rows[0].status),
                    updatedAt: updateResult.rows[0].updated_at,
                    shipmentId: shipmentMeta.shipmentId,
                    shipmentReferenceNumber: shipmentMeta.shipmentReferenceNumber,
                    shipmentCreationSkipped: shipmentMeta.shipmentCreationSkipped,
                    skipReason: shipmentMeta.skipReason,
                    domesticComplianceWarning
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    _toNumber(value, fallback = 0) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    async _isDemoUser(client, userId) {
        if (!userId) return false;

        const result = await client.query(
            'SELECT is_demo_user FROM users WHERE id = $1',
            [userId]
        );

        return result.rows[0]?.is_demo_user === true;
    }

    _toPayloadObject(payload) {
        if (!payload) return {};
        if (typeof payload === 'object' && !Array.isArray(payload)) {
            return payload;
        }
        if (typeof payload === 'string') {
            try {
                const parsed = JSON.parse(payload);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (error) {
                return {};
            }
        }
        return {};
    }

    _isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    _safeArray(value) {
        return Array.isArray(value) ? value : [];
    }

    _sumPercentage(items = []) {
        return items.reduce((sum, item) => {
            const percentage = this._toNumber(item?.percentage, 0);
            return sum + Math.max(0, percentage);
        }, 0);
    }

    _hasAddressData(location = {}) {
        if (!location || typeof location !== 'object') {
            return false;
        }
        return Boolean(
            this._isNonEmptyString(location.streetNumber) ||
            this._isNonEmptyString(location.street) ||
            this._isNonEmptyString(location.ward) ||
            this._isNonEmptyString(location.district) ||
            this._isNonEmptyString(location.city) ||
            this._isNonEmptyString(location.stateRegion) ||
            this._isNonEmptyString(location.country) ||
            this._isNonEmptyString(location.postalCode) ||
            Number.isFinite(location.lat) ||
            Number.isFinite(location.lng)
        );
    }

    _buildCarbonResultsWithConfidence(carbonResults, confidenceScore) {
        const normalizedScore = Math.round(clampConfidenceScore(confidenceScore) * 100) / 100;
        const normalizedLevel = getConfidenceLevel(normalizedScore);
        const safeCarbonResults = this._toPayloadObject(carbonResults);

        return {
            ...safeCarbonResults,
            confidenceLevel: normalizedLevel,
            confidence_level: normalizedLevel,
            confidenceScore: normalizedScore,
            confidence_score: normalizedScore
        };
    }

    _computeDataConfidenceScore(productData = {}) {
        const payload = this._toPayloadObject(productData);
        const carbonResults = this._toPayloadObject(payload.carbonResults);
        const providedScore = this._toNumber(
            carbonResults.confidenceScore ??
            carbonResults.confidence_score ??
            payload.confidenceScore ??
            payload.confidence_score,
            Number.NaN
        );

        if (Number.isFinite(providedScore)) {
            return Math.round(clampConfidenceScore(providedScore) * 100) / 100;
        }

        const materials = this._safeArray(payload.materials);
        const productionProcesses = this._safeArray(payload.productionProcesses);
        const energySources = this._safeArray(payload.energySources);
        const transportLegs = this._safeArray(payload.transportLegs ?? payload.transport_legs);
        const originAddress = payload.originAddress ?? payload.origin_address;
        const destinationAddress = payload.destinationAddress ?? payload.destination_address;
        const estimatedTotalDistance = this._toNumber(
            payload.estimatedTotalDistance ?? payload.estimated_total_distance,
            0
        );

        let score = 0;

        // 1) Materials completeness (0-35)
        if (materials.length > 0) {
            const totalMaterialPercentage = this._sumPercentage(materials);
            const completeRatio =
                totalMaterialPercentage >= 95 && totalMaterialPercentage <= 105 ?
                1 :
                Math.max(0, Math.min(1, totalMaterialPercentage / 100));

            const typedCount = materials.filter((item) =>
                this._isNonEmptyString(item?.materialType)
            ).length;
            const knownOriginCount = materials.filter((item) => {
                const source = String(item?.source || '').trim().toLowerCase();
                return source.length > 0 && source !== 'unknown';
            }).length;

            score += 15 * completeRatio;
            score += 10 * (typedCount / materials.length);
            score += 10 * (knownOriginCount / materials.length);
        } else {
            score += 4;
        }

        // 2) Manufacturing completeness (0-25)
        if (productionProcesses.length > 0) {
            score += 12;
        }
        if (this._isNonEmptyString(payload.manufacturingLocation)) {
            score += 8;
        }
        if (this._isNonEmptyString(payload.wasteRecovery)) {
            score += 5;
        }

        // 3) Energy completeness (0-15)
        if (energySources.length > 0) {
            const energyTotalPercentage = this._sumPercentage(energySources);
            const energyCompleteness =
                energyTotalPercentage >= 95 && energyTotalPercentage <= 105 ?
                1 :
                Math.max(0, Math.min(1, energyTotalPercentage / 100));
            const validEnergyCount = energySources.filter((source) =>
                this._isNonEmptyString(source?.source)
            ).length;

            score += 10 * energyCompleteness;
            score += 5 * (validEnergyCount / energySources.length);
        } else {
            score += 3;
        }

        // 4) Logistics completeness (0-20)
        const legsWithDistance = transportLegs.filter((leg) =>
            this._toNumber(leg?.estimatedDistance ?? leg?.estimated_distance ?? leg?.distance_km, 0) > 0
        ).length;

        if (transportLegs.length > 0) {
            score += 8;
            score += 6 * (legsWithDistance / transportLegs.length);

            const legsWithMode = transportLegs.filter((leg) =>
                this._isNonEmptyString(leg?.mode ?? leg?.transport_mode)
            ).length;
            score += 3 * (legsWithMode / transportLegs.length);
        } else if (estimatedTotalDistance > 0) {
            score += 9;
        }

        const hasOrigin = this._hasAddressData(originAddress);
        const hasDestination = this._hasAddressData(destinationAddress);
        if (hasOrigin && hasDestination) {
            score += 3;
        } else if (hasOrigin || hasDestination) {
            score += 1.5;
        }

        // 5) Proxy usage penalty (up to -20)
        const proxyNotesRaw = this._safeArray(
            carbonResults.proxyNotes ?? carbonResults.proxy_notes
        ).map((item) => String(item || '').trim()).filter(Boolean);
        const uniqueProxyNotes = [...new Set(proxyNotesRaw)];
        const proxyUsed = Boolean(
            carbonResults.proxyUsed ??
            carbonResults.proxy_used ??
            uniqueProxyNotes.length > 0
        );

        let penalty = 0;
        if (proxyUsed) {
            penalty += 8;
        }
        penalty += Math.min(12, uniqueProxyNotes.length * 2);

        const materialUnknownOriginCount = materials.filter((item) => {
            const source = String(item?.source || '').trim().toLowerCase();
            return source === 'unknown';
        }).length;
        penalty += Math.min(6, materialUnknownOriginCount * 2);

        score = Math.max(0, score - penalty);

        return Math.round(clampConfidenceScore(score) * 100) / 100;
    }

    _extractDestinationMarketFromPayload(payload = {}, targetMarkets = []) {
        const resolveString = (value) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed.length > 0 ? trimmed : null;
            }
            if (typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            }
            return null;
        };

        const resolveRecursive = (value) => {
            const direct = resolveString(value);
            if (direct) return direct;

            if (Array.isArray(value)) {
                const selected = value.find((entry) =>
                    entry &&
                    typeof entry === 'object' &&
                    (
                        entry.selected === true ||
                        entry.isSelected === true ||
                        entry.default === true ||
                        entry.current === true ||
                        entry.active === true ||
                        (typeof entry.status === 'string' && entry.status.trim().toLowerCase() === 'selected')
                    )
                );
                if (selected) {
                    const selectedValue = resolveRecursive(selected);
                    if (selectedValue) return selectedValue;
                }

                for (const entry of value) {
                    const resolved = resolveRecursive(entry);
                    if (resolved) return resolved;
                }
                return null;
            }

            if (value && typeof value === 'object') {
                const directCandidates = [
                    value.destinationMarket,
                    value.destination_market,
                    value.destinationMarketCode,
                    value.destination_market_code,
                    value.marketCode,
                    value.market_code,
                    value.targetMarket,
                    value.target_market,
                    value.market,
                    value.destinationCountry,
                    value.destination_country,
                    value.country
                ];

                for (const candidate of directCandidates) {
                    const resolved = resolveRecursive(candidate);
                    if (resolved) return resolved;
                }

                const nestedCandidates = [
                    value.step4_logistics,
                    value.logistics,
                    value.destination,
                    value.destinationAddress,
                    value.destination_address,
                    value.selected,
                    value.current,
                    value.default,
                    value.value,
                    value.code,
                    value.id,
                    value.name,
                    value.label,
                    value.options,
                    value.items,
                    value.values,
                    value.markets,
                    value.destinationMarkets,
                    value.destination_markets
                ];
                for (const candidate of nestedCandidates) {
                    const resolved = resolveRecursive(candidate);
                    if (resolved) return resolved;
                }
            }

            return null;
        };

        const resolvedFromPayload = resolveRecursive(payload);
        if (resolvedFromPayload) {
            return resolvedFromPayload;
        }

        if (Array.isArray(targetMarkets) && targetMarkets.length > 0) {
            const fallbackCode = resolveString(targetMarkets[0]);
            if (fallbackCode) {
                return fallbackCode.toUpperCase();
            }
        }

        return '';
    }

    _toPositiveInt(value, fallback = 1) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    }

    _normalizeTransportMode(value) {
        const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return TRANSPORT_MODE_ALIASES[raw] || 'road';
    }

    _toLocationAddressString(location = {}) {
        const pieces = [
            location.address,
            [location.streetNumber, location.street].filter(Boolean).join(' ').trim(),
            location.ward,
            location.district
        ]
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean);

        return pieces.length > 0 ? pieces.join(', ') : null;
    }

    _toLocationCity(location = {}) {
        const city = typeof location.city === 'string' ? location.city.trim() : '';
        if (city) return city;
        const state = typeof location.stateRegion === 'string' ? location.stateRegion.trim() : '';
        return state || null;
    }

    _toLocationCountry(location = {}) {
        const country = typeof location.country === 'string' ? location.country.trim() : '';
        return country || null;
    }

    _toLocationLabel(location = {}) {
        return (
            this._toLocationCity(location) ||
            this._toLocationAddressString(location) ||
            this._toLocationCountry(location) ||
            'Unknown'
        );
    }

    _extractLogisticsFromPayload(payload = {}) {
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
    }

    _normalizeShipmentLegs(rawLegs, origin, destination, fallbackTotalCo2e) {
        const legs = Array.isArray(rawLegs) ? rawLegs : [];
        if (legs.length === 0) {
            return [];
        }

        const originLabel = this._toLocationLabel(origin);
        const destinationLabel = this._toLocationLabel(destination);

        const normalized = legs.map((rawLeg, index) => {
            const mode = this._normalizeTransportMode(
                rawLeg?.transport_mode ||
                rawLeg?.transportMode ||
                rawLeg?.mode ||
                rawLeg?.vehicle_type ||
                rawLeg?.vehicleType ||
                rawLeg?.type
            );

            const distanceKm = Math.max(
                0,
                this._toNumber(
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
                this._toNumber(
                    rawLeg?.emission_factor_used ??
                    rawLeg?.emission_factor ??
                    rawLeg?.emissionFactor,
                    defaultFactor
                )
            );

            const parsedCo2 = this._toNumber(
                rawLeg?.co2e ??
                rawLeg?.co2_kg ??
                rawLeg?.co2Kg ??
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
                    this._toNumber(rawLeg?.duration_hours ?? rawLeg?.durationHours, 0)
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
            });
        }

        return normalized.map((leg) => ({
            ...leg,
            distance_km: Math.max(0, this._toNumber(leg.distance_km, 0)),
            co2e: Math.max(0, this._toNumber(leg.co2e, 0)),
            emission_factor_used: Math.max(
                0,
                this._toNumber(
                    leg.emission_factor_used,
                    DEFAULT_EMISSION_FACTOR_BY_MODE[leg.transport_mode] || DEFAULT_EMISSION_FACTOR_BY_MODE.road
                )
            )
        }));
    }

    _toEstimatedArrivalDate(value) {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            const raw = String(value).trim();
            return raw.length > 0 ? raw : null;
        }
        return parsed.toISOString().slice(0, 10);
    }

    async _syncShipmentFromProduct(client, productId, companyId, product, options = {}) {
        const payload = product?.payload || {};
        const { origin, destination, transportLegs, estimatedArrival } = this._extractLogisticsFromPayload(payload);

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

        const fallbackTotalCo2e = Math.max(0, this._toNumber(product.total_co2e, 0));
        const normalizedLegs = this._normalizeShipmentLegs(
            transportLegs,
            origin,
            destination,
            fallbackTotalCo2e
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
        const quantity = this._toPositiveInt(payload?.quantity, 1);
        const unitWeightKg = Math.max(0, this._toNumber(product.weight_kg, 0));
        const totalWeightKg = unitWeightKg > 0 ? unitWeightKg * quantity : unitWeightKg;

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
            return this._createShipmentFromProduct(client, productId, companyId, product, options);
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
            this._toEstimatedArrivalDate(estimatedArrival);

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
                this._toLocationCity(origin),
                this._toLocationAddressString(origin),
                origin.lat || null,
                origin.lng || null,
                destination.country,
                this._toLocationCity(destination),
                this._toLocationAddressString(destination),
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
    async _createShipmentFromProduct(client, productId, companyId, product, options = {}) {
        try {
            const payload = product?.payload || {};
            const { origin, destination, transportLegs, estimatedArrival } = this._extractLogisticsFromPayload(payload);

            if (!origin || !destination) {
                console.log(`Product ${productId}: No logistics data in payload, skipping shipment creation`);
                return { 
                    shipmentId: null, 
                    shipmentReferenceNumber: null,
                    shipmentCreationSkipped: true, 
                    skipReason: 'MISSING_LOGISTICS_DATA' 
                };
            }

            // Require at least origin and destination country
            if (!origin?.country || !destination?.country) {
                console.log(`Product ${productId}: Missing origin/destination country (origin.country=${origin?.country}, destination.country=${destination?.country}), skipping shipment creation`);
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
            const fallbackTotalCo2e = Math.max(0, this._toNumber(product.total_co2e, 0));
            const legs = this._normalizeShipmentLegs(transportLegs, origin, destination, fallbackTotalCo2e);
            if (legs.length === 0) {
                console.log(`Product ${productId}: No transport legs in payload, skipping shipment creation`);
                return {
                    shipmentId: null,
                    shipmentReferenceNumber: null,
                    shipmentCreationSkipped: true,
                    skipReason: 'MISSING_TRANSPORT_LEGS'
                };
            }
            const totalDistanceKm = legs.reduce((sum, leg) => sum + leg.distance_km, 0);
            const totalCo2e = legs.reduce((sum, leg) => sum + leg.co2e, 0) || fallbackTotalCo2e;
            const quantity = this._toPositiveInt(payload?.quantity, 1);
            const unitWeightKg = Math.max(0, this._toNumber(product.weight_kg, 0));
            const totalWeightKg = unitWeightKg > 0 ? unitWeightKg * quantity : unitWeightKg;

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
                this._toEstimatedArrivalDate(estimatedArrival);

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
                this._toLocationCity(origin),
                this._toLocationAddressString(origin),
                origin.lat || null,
                origin.lng || null,
                destination.country,
                this._toLocationCity(destination),
                this._toLocationAddressString(destination),
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

            console.log(`Product ${productId}: Created shipment ${shipmentId} (${refNumber}) from origin=${origin.country} destination=${destination.country}`);
            return { 
                shipmentId, 
                shipmentReferenceNumber: refNumber,
                shipmentCreationSkipped: false, 
                skipReason: null 
            };
        } catch (error) {
            console.error(`Error creating shipment from product ${productId}:`, error);
            // Don't fail the whole transaction, just log and continue
            return { 
                shipmentId: null, 
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: true, 
                skipReason: 'SHIPMENT_CREATE_ERROR' 
            };
        }
    }

    /**
     * Delete product permanently and clean up related links.
     */
    async deleteProduct(productId, companyId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const productResult = await client.query(
                `
                SELECT id
                FROM products
                WHERE id = $1 AND company_id = $2
                `,
                [productId, companyId]
            );

            if (productResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            const batchLinksResult = await client.query(
                `
                SELECT DISTINCT batch_id
                FROM product_batch_items
                WHERE product_id = $1
                `,
                [productId]
            );
            const affectedBatchIds = batchLinksResult.rows.map((row) => row.batch_id);

            const shipmentLinksResult = await client.query(
                `
                SELECT DISTINCT sp.shipment_id
                FROM shipment_products sp
                INNER JOIN shipments s ON s.id = sp.shipment_id
                WHERE sp.product_id = $1
                  AND s.company_id = $2
                `,
                [productId, companyId]
            );
            const affectedShipmentIds = shipmentLinksResult.rows.map((row) => row.shipment_id);

            await client.query(
                `
                DELETE FROM product_batch_items
                WHERE product_id = $1
                `,
                [productId]
            );

            for (const batchId of affectedBatchIds) {
                await client.query(
                    `
                    UPDATE product_batches
                    SET
                        total_products = (SELECT COUNT(*) FROM product_batch_items WHERE batch_id = $1),
                        total_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM product_batch_items WHERE batch_id = $1),
                        total_weight_kg = (SELECT COALESCE(SUM(quantity * weight_kg), 0) FROM product_batch_items WHERE batch_id = $1),
                        total_co2e = (SELECT COALESCE(SUM(quantity * co2_per_unit), 0) FROM product_batch_items WHERE batch_id = $1),
                        updated_at = NOW()
                    WHERE id = $1
                    `,
                    [batchId]
                );
            }

            await client.query(
                `
                DELETE FROM shipment_products sp
                USING shipments s
                WHERE sp.shipment_id = s.id
                  AND sp.product_id = $1
                  AND s.company_id = $2
                `,
                [productId, companyId]
            );

            for (const shipmentId of affectedShipmentIds) {
                const shipmentTotalsResult = await client.query(
                    `
                    SELECT
                        COUNT(*)::int AS count,
                        COALESCE(SUM(weight_kg), 0) AS total_weight_kg,
                        COALESCE(SUM(allocated_co2e), 0) AS total_co2e
                    FROM shipment_products
                    WHERE shipment_id = $1
                    `,
                    [shipmentId]
                );

                const remainingCount = Number.parseInt(shipmentTotalsResult.rows[0]?.count, 10) || 0;

                if (remainingCount === 0) {
                    await client.query(
                        `
                        DELETE FROM shipments
                        WHERE id = $1 AND company_id = $2
                        `,
                        [shipmentId, companyId]
                    );
                    continue;
                }

                await client.query(
                    `
                    UPDATE shipments
                    SET
                        total_weight_kg = $2,
                        total_co2e = $3,
                        updated_at = NOW()
                    WHERE id = $1 AND company_id = $4
                    `,
                    [
                        shipmentId,
                        shipmentTotalsResult.rows[0]?.total_weight_kg || 0,
                        shipmentTotalsResult.rows[0]?.total_co2e || 0,
                        companyId
                    ]
                );
            }

            await client.query(
                `
                DELETE FROM products
                WHERE id = $1 AND company_id = $2
                `,
                [productId, companyId]
            );

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
     * Bulk import products
     */
    async bulkImport(companyId, userId, rows, saveMode = 'draft') {
        await ensureShipmentSimulationSchema();

        const client = await pool.connect();
        const imported = [];
        const failed = [];
        const errors = [];

        try {
            await client.query('BEGIN');
            const isDemoUser = await this._isDemoUser(client, userId);

            const dbStatus = saveMode === 'publish' ? 'active' : 'draft';

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                try {
                    const payload = this._toPayloadObject(row);
                    const productCode = String(
                        payload.productCode ??
                        payload.product_code ??
                        payload.sku ??
                        ''
                    ).trim();
                    const productName = String(
                        payload.productName ??
                        payload.product_name ??
                        payload.name ??
                        ''
                    ).trim();
                    const productType = String(
                        payload.productType ??
                        payload.product_type ??
                        payload.category ??
                        ''
                    ).trim();

                    // Check duplicate
                    const checkQuery = `SELECT id FROM products WHERE company_id = $1 AND sku = $2`;
                    const checkResult = await client.query(checkQuery, [companyId, productCode]);

                    if (checkResult.rows.length > 0) {
                        throw { code: 'DUPLICATE_SKU', message: 'SKU already exists' };
                    }

                    // Insert product
                    const insertQuery = `
                        INSERT INTO products (
                            company_id,
                            sku,
                            name,
                            category,
                            weight_kg,
                            status,
                            total_co2e,
                            materials_co2e,
                            production_co2e,
                            transport_co2e,
                            packaging_co2e,
                            data_confidence_score
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                        RETURNING id
                    `;

                    const rawWeightPerUnit = this._toNumber(
                        payload.weightPerUnit ?? payload.weight_per_unit,
                        Number.NaN
                    );
                    const directWeightKg = this._toNumber(
                        payload.weightKg ?? payload.weight_kg,
                        Number.NaN
                    );
                    const weightKg =
                        Number.isFinite(rawWeightPerUnit) && rawWeightPerUnit > 0 ?
                        rawWeightPerUnit / 1000 :
                        (Number.isFinite(directWeightKg) && directWeightKg > 0 ? directWeightKg : null);
                    const carbonResults = payload.carbonResults ?? payload.carbon_results;
                    const snapshotPayload = {
                        ...payload
                    };
                    delete snapshotPayload.carbonResults;
                    delete snapshotPayload.carbon_results;
                    delete snapshotPayload.save_mode;

                    const computedConfidenceScore = this._computeDataConfidenceScore({
                        ...snapshotPayload,
                        carbonResults
                    });
                    const normalizedCarbonResults = this._buildCarbonResultsWithConfidence(
                        carbonResults,
                        computedConfidenceScore
                    );
                    const totalCo2e = normalizedCarbonResults?.perProduct?.total || 0;
                    const materialsCo2e = normalizedCarbonResults?.perProduct?.materials || 0;
                    const productionCo2e = normalizedCarbonResults?.perProduct?.production || 0;
                    const transportCo2e = normalizedCarbonResults?.perProduct?.transport || 0;
                    const packagingCo2e = normalizedCarbonResults?.perProduct?.packaging || 0;

                    const insertResult = await client.query(insertQuery, [
                        companyId,
                        productCode,
                        productName,
                        productType || null,
                        weightKg,
                        dbStatus,
                        totalCo2e,
                        materialsCo2e,
                        productionCo2e,
                        transportCo2e,
                        packagingCo2e,
                        computedConfidenceScore
                    ]);

                    const productId = insertResult.rows[0].id;

                    // Create snapshot
                    const snapshotQuery = `
                        INSERT INTO product_assessment_snapshots (product_id, version, payload)
                        VALUES ($1, 1, $2)
                    `;

                    const fullPayload = {
                        ...snapshotPayload,
                        carbonResults: normalizedCarbonResults
                    };

                    await client.query(snapshotQuery, [productId, JSON.stringify(fullPayload)]);

                    if (dbStatus === 'active') {
                        const domesticComplianceValidation =
                            await domesticComplianceService.validateProductsForDomesticPublish(
                                client,
                                companyId,
                                [productId]
                            );

                        if (!domesticComplianceValidation.success) {
                            throw domesticComplianceService.createMissingDocumentsError(
                                domesticComplianceValidation
                            );
                        }

                        await this._createShipmentFromProduct(
                            client,
                            productId,
                            companyId,
                            {
                                id: productId,
                                weight_kg: weightKg,
                                total_co2e: totalCo2e,
                                payload: fullPayload
                            },
                            { isDemoUser }
                        );
                    }

                    imported.push(productId);
                } catch (error) {
                    failed.push(i);
                    errors.push({
                        row: i + 1,
                        code: error.code || 'UNKNOWN_ERROR',
                        message: error.message || 'Failed to import row'
                    });
                }
            }

            await client.query('COMMIT');

            return {
                imported: imported.length,
                failed: failed.length,
                errors,
                ids: imported
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ProductsService();
