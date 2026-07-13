const pool = require('../../config/database');
const domesticComplianceService = require('../domesticComplianceService');
const { ensureShipmentSimulationSchema } = require('../shipmentSimulationService');
const { toNumber, toPayloadObject, isDemoUser } = require('./shared');
const { computeDataConfidenceScore, buildCarbonResultsWithConfidence } = require('./carbonScoring');
const { createShipmentFromProduct } = require('./shipmentSync');

async function bulkImport(companyId, userId, rows, saveMode = 'draft') {
    await ensureShipmentSimulationSchema();

    const client = await pool.connect();
    const imported = [];
    const failed = [];
    const errors = [];

    try {
        await client.query('BEGIN');
        const isDemoUserFlag = await isDemoUser(client, userId);

        const dbStatus = saveMode === 'publish' ? 'active' : 'draft';

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const payload = toPayloadObject(row);
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

                const rawWeightPerUnit = toNumber(
                    payload.weightPerUnit ?? payload.weight_per_unit,
                    Number.NaN
                );
                const directWeightKg = toNumber(
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

                const computedConfidenceScore = computeDataConfidenceScore({
                    ...snapshotPayload,
                    carbonResults
                });
                const normalizedCarbonResults = buildCarbonResultsWithConfidence(
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

                    await createShipmentFromProduct(
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

module.exports = { bulkImport };
