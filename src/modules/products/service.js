const pool = require('../shared/database');
const domesticComplianceService = require('../shared/domesticCompliance');
const { ensureShipmentSimulationSchema } = require('../shared/shipmentSimulation');
const {
    dbToFeStatus,
    feToDbStatus,
    getConfidenceLevel,
    clampConfidenceScore,
    buildDomesticComplianceWarning
} = require('./services/mappers');
const {
    toPayloadObject,
    isDemoUser
} = require('./services/shared');
const { validateBulkImportRows } = require('./services/bulkImportValidation');
const {
    computeDataConfidenceScore
} = require('./services/carbonScoring');
const {
    syncShipmentFromProduct,
    createShipmentFromProduct
} = require('./services/shipmentSync');
const {
    extractDestinationMarketFromPayload,
    extractV2MetadataFromPayload
} = require('./services/payloadExtraction');
const { bulkImport: executeBulkImport } = require('./services/bulkImportExecution');
const {
    calculateAuthoritativeProductCarbon,
    stripClientCarbonOutputs,
    buildCarbonAuthorityReference,
    insertFinalizedProductSnapshot
} = require('../carbon');

class ProductsService {
    constructor({
        database = pool,
        complianceService = domesticComplianceService,
        ensureSimulationSchema = ensureShipmentSimulationSchema,
        bulkImportProducts = executeBulkImport,
        calculateProductCarbon = calculateAuthoritativeProductCarbon,
        sanitizeCarbonPayload = stripClientCarbonOutputs,
        insertProductSnapshot = insertFinalizedProductSnapshot
    } = {}) {
        this.database = database;
        this.complianceService = complianceService;
        this.ensureSimulationSchema = ensureSimulationSchema;
        this.bulkImportProducts = bulkImportProducts;
        this.calculateProductCarbon = calculateProductCarbon;
        this.sanitizeCarbonPayload = sanitizeCarbonPayload;
        this.insertProductSnapshot = insertProductSnapshot;
    }

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
            view
        } = filters;

        // Summary view: skip the latest-shipment join and the per-row logistics
        // payload (addresses, transport legs, v2 metadata) for consumers that only
        // need the core catalog + carbon totals (e.g. the global ProductContext).
        const isSummary = view === 'summary';

        const client = await this.database.connect();
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
                    SELECT
                        id AS snapshot_id,
                        product_id,
                        version AS snapshot_version,
                        payload,
                        calculated_at AS snapshot_calculated_at,
                        engine_version AS snapshot_engine_version,
                        methodology_version AS snapshot_methodology_version,
                        factor_registry_version AS snapshot_factor_registry_version,
                        gwp_basis AS snapshot_gwp_basis,
                        canonical_input_hash AS snapshot_canonical_input_hash,
                        is_legacy AS snapshot_is_legacy
                    FROM latest_product_assessment_snapshots
                    WHERE product_id = ANY($1)
                `;
                const snapshotsResult = await client.query(snapshotsQuery, [productIds]);
                snapshotsResult.rows.forEach(row => {
                    snapshotsMap[row.product_id] = row;
                });

                if (!isSummary) {
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
            }

            const items = productsResult.rows.map(row => {
                if (isSummary) {
                    const snapshotRecord = snapshotsMap[row.id] || {};
                    const snapshotSummary = toPayloadObject(snapshotRecord.payload);
                    const summaryConfidence = (() => {
                        const computed = computeDataConfidenceScore(snapshotSummary);
                        if (computed > 0) return computed;
                        return clampConfidenceScore(row.data_confidence_score);
                    })();

                    return {
                        id: row.id,
                        productCode: row.sku,
                        productName: row.name,
                        productType: row.category,
                        weightPerUnit: row.weight_kg ? row.weight_kg * 1000 : null,
                        quantity: snapshotSummary.quantity || null,
                        status: dbToFeStatus(row.status),
                        materials: snapshotSummary.materials || [],
                        carbonResults: {
                            perProduct: {
                                materials: parseFloat(row.materials_co2e) || 0,
                                production: parseFloat(row.production_co2e) || 0,
                                energy: snapshotSummary.carbonResults?.perProduct?.energy || 0,
                                transport: parseFloat(row.transport_co2e) || 0,
                                packaging: parseFloat(row.packaging_co2e) || 0,
                                total: parseFloat(row.total_co2e) || 0
                            },
                            totalBatch: snapshotSummary.carbonResults?.totalBatch || {},
                            confidenceLevel: getConfidenceLevel(summaryConfidence),
                            confidenceScore: summaryConfidence,
                            proxyUsed: snapshotSummary.carbonResults?.proxyUsed || false,
                            proxyNotes: snapshotSummary.carbonResults?.proxyNotes || [],
                            scope1: snapshotSummary.carbonResults?.scope1 || 0,
                            scope2: snapshotSummary.carbonResults?.scope2 || 0,
                            scope3: snapshotSummary.carbonResults?.scope3 || 0
                        },
                        carbonAuthority: buildCarbonAuthorityReference(snapshotRecord),
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
                    };
                }

                const latestShipment = latestShipmentMap[row.id] || null;
                const snapshotRecord = snapshotsMap[row.id] || {};
                const snapshot = toPayloadObject(snapshotRecord.payload);
                const destinationMarket = extractDestinationMarketFromPayload(
                    snapshot,
                    row.target_markets
                );
                const snapshotLogistics = toPayloadObject(snapshot.logistics);
                const snapshotStep4 = toPayloadObject(snapshot.step4_logistics);
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
                    const computed = computeDataConfidenceScore(snapshot);
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
                    ...extractV2MetadataFromPayload(snapshot),
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
                    carbonAuthority: buildCarbonAuthorityReference(snapshotRecord),
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
        const client = await this.database.connect();
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
                SELECT
                    id AS snapshot_id,
                    version AS snapshot_version,
                    payload,
                    calculated_at AS snapshot_calculated_at,
                    engine_version AS snapshot_engine_version,
                    methodology_version AS snapshot_methodology_version,
                    factor_registry_version AS snapshot_factor_registry_version,
                    gwp_basis AS snapshot_gwp_basis,
                    canonical_input_hash AS snapshot_canonical_input_hash,
                    is_legacy AS snapshot_is_legacy
                FROM latest_product_assessment_snapshots
                WHERE product_id = $1
                ORDER BY version DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            `;
            const snapshotResult = await client.query(snapshotQuery, [productId]);

            let payload = {};
            let version = 1;
            let carbonAuthority = null;

            if (snapshotResult.rows.length > 0) {
                version = snapshotResult.rows[0].snapshot_version ?? snapshotResult.rows[0].version;
                payload = toPayloadObject(snapshotResult.rows[0].payload);
                carbonAuthority = buildCarbonAuthorityReference(snapshotResult.rows[0]);
            }
            const destinationMarket = extractDestinationMarketFromPayload(
                payload,
                product.target_markets
            );
            const confidenceScore = (() => {
                const computed = computeDataConfidenceScore(payload);
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
                },
                carbonAuthority
            };
        } finally {
            client.release();
        }
    }

    /**
     * Create new product
     */
    async createProduct(companyId, userId, productData) {
        await this.ensureSimulationSchema();
        const authoritativeCarbon = this.calculateProductCarbon(productData);
        const {
            productCode,
            productName,
            productType,
            weightPerUnit,
            quantity,
            save_mode = 'draft',
            ...snapshotPayload
        } = productData;

        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const isDemoUserFlag = await isDemoUser(client, userId);

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
            const payloadWithoutCarbonResults = this.sanitizeCarbonPayload({
                quantity,
                ...snapshotPayload
            });
            const normalizedCarbonResults = authoritativeCarbon.result;
            const computedConfidenceScore = normalizedCarbonResults.confidenceScore;
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

            const calculationSnapshot = await this.insertProductSnapshot(client, {
                productId: product.id,
                assessmentPayload: payloadWithoutCarbonResults,
                input: authoritativeCarbon.input,
                result: normalizedCarbonResults
            });
            const fullPayload = calculationSnapshot.payload;

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
                    await this.complianceService.validateProductsForDomesticPublish(
                        client,
                        companyId,
                        [product.id]
                    );

                if (!domesticComplianceValidation.success) {
                    domesticComplianceWarning = buildDomesticComplianceWarning(domesticComplianceValidation);
                }

                shipmentMeta = await createShipmentFromProduct(
                    client,
                    product.id,
                    companyId,
                    {
                        ...product,
                        weight_kg: weightKg,
                        total_co2e: totalCo2e,
                        transport_co2e: transportCo2e,
                        payload: fullPayload
                    },
                    { isDemoUser: isDemoUserFlag }
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
                domesticComplianceWarning,
                carbonResults: normalizedCarbonResults,
                carbonAuthority: buildCarbonAuthorityReference(calculationSnapshot.row)
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
        await this.ensureSimulationSchema();
        const {
            productCode,
            productName,
            productType,
            weightPerUnit,
            quantity,
            ...snapshotPayload
        } = productData;

        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const isDemoUserFlag = await isDemoUser(client, userId);

            // Check product exists
            const checkQuery = `
                SELECT id, status FROM products
                WHERE id = $1 AND company_id = $2
                FOR UPDATE
            `;
            const checkResult = await client.query(checkQuery, [productId, companyId]);

            if (checkResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            const authoritativeCarbon = this.calculateProductCarbon(productData);

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
            const payloadWithoutCarbonResults = this.sanitizeCarbonPayload({
                quantity,
                ...snapshotPayload
            });
            const normalizedCarbonResults = authoritativeCarbon.result;
            const computedConfidenceScore = normalizedCarbonResults.confidenceScore;
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

            const calculationSnapshot = await this.insertProductSnapshot(client, {
                productId,
                assessmentPayload: payloadWithoutCarbonResults,
                input: authoritativeCarbon.input,
                result: normalizedCarbonResults
            });
            const fullPayload = calculationSnapshot.payload;

            let shipmentMeta = {
                shipmentId: null,
                shipmentReferenceNumber: null,
                shipmentCreationSkipped: false,
                skipReason: null
            };

            if (checkResult.rows[0].status === 'active') {
                shipmentMeta = await syncShipmentFromProduct(
                    client,
                    productId,
                    companyId,
                    {
                        id: productId,
                        weight_kg: weightKg,
                        total_co2e: totalCo2e,
                        transport_co2e: transportCo2e,
                        payload: fullPayload
                    },
                    { isDemoUser: isDemoUserFlag }
                );
            }

            await client.query('COMMIT');

            const version = calculationSnapshot.row.snapshot_version;

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
                    skipReason: shipmentMeta.skipReason,
                    carbonResults: normalizedCarbonResults,
                    carbonAuthority: buildCarbonAuthorityReference(calculationSnapshot.row)
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
        await this.ensureSimulationSchema();

        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const isDemoUserFlag = await isDemoUser(client, userId);

            // Get current status and product weight (with latest snapshot)
            const selectQuery = `
                SELECT p.id, p.status,
                    p.weight_kg,
                    p.total_co2e,
                    p.transport_co2e,
                    s.snapshot_id,
                    s.snapshot_version,
                    s.snapshot_calculated_at,
                    s.snapshot_engine_version,
                    s.snapshot_methodology_version,
                    s.snapshot_factor_registry_version,
                    s.snapshot_gwp_basis,
                    s.snapshot_canonical_input_hash,
                    s.snapshot_is_legacy,
                    s.payload
                FROM products p
                LEFT JOIN LATERAL (
                    SELECT
                        id AS snapshot_id,
                        version AS snapshot_version,
                        calculated_at AS snapshot_calculated_at,
                        engine_version AS snapshot_engine_version,
                        methodology_version AS snapshot_methodology_version,
                        factor_registry_version AS snapshot_factor_registry_version,
                        gwp_basis AS snapshot_gwp_basis,
                        canonical_input_hash AS snapshot_canonical_input_hash,
                        is_legacy AS snapshot_is_legacy,
                        payload
                    FROM latest_product_assessment_snapshots ps
                    WHERE ps.product_id = p.id
                ) s ON true
                WHERE p.id = $1 AND p.company_id = $2
                FOR UPDATE OF p
            `;
            const selectResult = await client.query(selectQuery, [productId, companyId]);

            if (selectResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            const product = selectResult.rows[0];
            const currentStatus = dbToFeStatus(product.status);
            let domesticComplianceWarning = null;
            let authoritativeCarbonResults;
            let carbonAuthority = buildCarbonAuthorityReference(product);

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
                const snapshotPayload = toPayloadObject(product.payload);
                const authoritativeCarbon = this.calculateProductCarbon({
                    ...snapshotPayload,
                    weightPerUnit: Number(product.weight_kg || 0) * 1000
                });
                authoritativeCarbonResults = authoritativeCarbon.result;
                const sanitizedSnapshot = this.sanitizeCarbonPayload(snapshotPayload);

                const domesticComplianceValidation =
                    await this.complianceService.validateProductsForDomesticPublish(
                        client,
                        companyId,
                        [productId]
                    );

                if (!domesticComplianceValidation.success) {
                    domesticComplianceWarning = buildDomesticComplianceWarning(domesticComplianceValidation);
                }

                await client.query(
                    `
                    UPDATE products
                    SET total_co2e = $1,
                        materials_co2e = $2,
                        production_co2e = $3,
                        transport_co2e = $4,
                        packaging_co2e = $5,
                        data_confidence_score = $6,
                        updated_at = NOW()
                    WHERE id = $7 AND company_id = $8
                    `,
                    [
                        authoritativeCarbonResults.perProduct.total,
                        authoritativeCarbonResults.perProduct.materials,
                        authoritativeCarbonResults.perProduct.production,
                        authoritativeCarbonResults.perProduct.transport,
                        authoritativeCarbonResults.perProduct.packaging,
                        authoritativeCarbonResults.confidenceScore,
                        productId,
                        companyId
                    ]
                );
                const calculationSnapshot = await this.insertProductSnapshot(client, {
                    productId,
                    assessmentPayload: sanitizedSnapshot,
                    input: authoritativeCarbon.input,
                    result: authoritativeCarbonResults
                });
                const authoritativeSnapshot = calculationSnapshot.payload;
                carbonAuthority = buildCarbonAuthorityReference(calculationSnapshot.row);
                product.total_co2e = authoritativeCarbonResults.perProduct.total;
                product.transport_co2e = authoritativeCarbonResults.perProduct.transport;
                product.payload = authoritativeSnapshot;
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
                shipmentMeta = await createShipmentFromProduct(
                    client,
                    productId,
                    companyId,
                    product,
                    { isDemoUser: isDemoUserFlag }
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
                    domesticComplianceWarning,
                    ...(authoritativeCarbonResults
                        ? {
                            carbonResults: authoritativeCarbonResults,
                            carbonAuthority
                        }
                        : {})
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }



    async validateBulkImportRows(companyId, rows = []) {
        return validateBulkImportRows(companyId, rows);
    }


    /**
     * Delete product permanently and clean up related links.
     */
    async deleteProduct(productId, companyId) {
        const client = await this.database.connect();
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
        return this.bulkImportProducts(companyId, userId, rows, saveMode);
    }
}

function createProductsService(dependencies) {
    return new ProductsService(dependencies);
}

const productsService = createProductsService();

module.exports = productsService;
module.exports.ProductsService = ProductsService;
module.exports.createProductsService = createProductsService;
