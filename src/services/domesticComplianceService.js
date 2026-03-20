const { randomUUID } = require('crypto');
const { normalizeTargetMarkets } = require('../constants/targetMarkets');
const { assertSchemaCapability } = require('../config/schemaCapabilities');
const {
    ensureCompaniesDomesticMarketColumn,
    normalizeDomesticMarket
} = require('../utils/companyMarkets');

const DONE_DOCUMENT_STATUSES = new Set(['uploaded', 'approved']);
const DEFAULT_DOMESTIC_MARKET_CODE = 'VN';

const FALLBACK_REQUIRED_DOCUMENTS_BY_MARKET = {
    VN: [
        { code: 'eia', name: 'Environmental Impact Assessment (EIA)' },
        { code: 'ghg_inventory_vn', name: 'GHG Inventory / MRV Declaration' },
        { code: 'local_compliance', name: 'Local Compliance Declaration' }
    ]
};

class DomesticComplianceService {
    _normalizeMarketCode(value) {
        return String(value || '').trim().toUpperCase();
    }

    _normalizeDocumentCode(value) {
        return String(value || '').trim().toLowerCase();
    }

    _normalizeUuidArray(values) {
        if (!Array.isArray(values)) return [];
        return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
    }

    async ensureProductComplianceDocumentsTable(client) {
        void client;
        assertSchemaCapability(
            'hasProductComplianceDocuments',
            'product_compliance_documents is missing. Run "npm run migrate" before starting the API.'
        );
    }

    async resolveCompanyDomesticMarketCode(client, companyId) {
        await ensureCompaniesDomesticMarketColumn(client);
        const result = await client.query(
            'SELECT domestic_market, target_markets FROM companies WHERE id = $1 LIMIT 1',
            [companyId]
        );
        const rawMarkets = Array.isArray(result.rows[0]?.target_markets) ? result.rows[0].target_markets : [];
        const normalizedMarkets = normalizeTargetMarkets(rawMarkets);
        return normalizeDomesticMarket(result.rows[0]?.domestic_market, normalizedMarkets) || DEFAULT_DOMESTIC_MARKET_CODE;
    }

    async listRequiredDocuments(client, marketCode) {
        const normalizedMarketCode = this._normalizeMarketCode(marketCode);

        const result = await client.query(
            `
            SELECT document_code, document_name
            FROM compliance_document_requirements
            WHERE UPPER(market_code) = $1
              AND required = TRUE
              AND is_active = TRUE
            ORDER BY document_name ASC
            `,
            [normalizedMarketCode]
        );

        if (result.rows.length > 0) {
            return result.rows
                .map((row) => ({
                    code: this._normalizeDocumentCode(row.document_code),
                    name: String(row.document_name || '').trim() || this._normalizeDocumentCode(row.document_code)
                }))
                .filter((row) => row.code.length > 0);
        }

        const fallback = FALLBACK_REQUIRED_DOCUMENTS_BY_MARKET[normalizedMarketCode] || [];
        return fallback.map((item) => ({
            code: this._normalizeDocumentCode(item.code),
            name: item.name
        }));
    }

    async ensureRequiredDocumentPlaceholders(client, companyId, marketCode, requiredDocuments) {
        const normalizedMarketCode = this._normalizeMarketCode(marketCode);
        const requiredCodes = requiredDocuments
            .map((doc) => this._normalizeDocumentCode(doc.code))
            .filter(Boolean);

        if (requiredCodes.length === 0) {
            return;
        }

        const existingResult = await client.query(
            `
            SELECT LOWER(document_code) AS document_code
            FROM compliance_documents
            WHERE company_id = $1
              AND UPPER(market_code) = $2
              AND LOWER(COALESCE(document_code, '')) = ANY($3)
            `,
            [companyId, normalizedMarketCode, requiredCodes]
        );

        const existingCodeSet = new Set(
            existingResult.rows.map((row) => this._normalizeDocumentCode(row.document_code))
        );

        for (const documentTemplate of requiredDocuments) {
            const normalizedCode = this._normalizeDocumentCode(documentTemplate.code);
            if (!normalizedCode || existingCodeSet.has(normalizedCode)) {
                continue;
            }

            await client.query(
                `
                INSERT INTO compliance_documents (
                    id, company_id, market_code, document_code, document_name, status, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, 'missing', NOW(), NOW())
                ON CONFLICT DO NOTHING
                `,
                [
                    randomUUID(),
                    companyId,
                    normalizedMarketCode,
                    normalizedCode,
                    documentTemplate.name || normalizedCode
                ]
            );

            existingCodeSet.add(normalizedCode);
        }
    }

    async linkDocumentToProducts(client, {
        companyId,
        marketCode,
        complianceDocumentId,
        productIds,
        userId,
        source = 'manual'
    }) {
        await this.ensureProductComplianceDocumentsTable(client);

        const normalizedMarketCode = this._normalizeMarketCode(marketCode);
        const normalizedProductIds = this._normalizeUuidArray(productIds);
        if (normalizedProductIds.length === 0) {
            return { linkedCount: 0, skippedCount: 0 };
        }

        const productsResult = await client.query(
            `
            SELECT id
            FROM products
            WHERE company_id = $1
              AND id = ANY($2::uuid[])
            `,
            [companyId, normalizedProductIds]
        );
        const validProductIds = productsResult.rows.map((row) => row.id);
        const validProductIdSet = new Set(validProductIds);

        if (validProductIds.length === 0) {
            return { linkedCount: 0, skippedCount: normalizedProductIds.length };
        }

        const documentResult = await client.query(
            `
            SELECT storage_key
            FROM compliance_documents
            WHERE id = $1 AND company_id = $2
            LIMIT 1
            `,
            [complianceDocumentId, companyId]
        );

        const storageKeySnapshot = String(documentResult.rows[0]?.storage_key || '').trim() || null;
        let linkedCount = 0;

        for (const productId of validProductIds) {
            await client.query(
                `
                INSERT INTO product_compliance_documents (
                    id,
                    company_id,
                    product_id,
                    compliance_document_id,
                    market_code,
                    storage_key_snapshot,
                    source,
                    created_by,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                ON CONFLICT (product_id, compliance_document_id) DO UPDATE
                SET market_code = EXCLUDED.market_code,
                    storage_key_snapshot = EXCLUDED.storage_key_snapshot,
                    source = EXCLUDED.source,
                    created_by = EXCLUDED.created_by,
                    updated_at = NOW()
                `,
                [
                    randomUUID(),
                    companyId,
                    productId,
                    complianceDocumentId,
                    normalizedMarketCode,
                    storageKeySnapshot,
                    source,
                    userId || null
                ]
            );
            linkedCount += 1;
        }

        return {
            linkedCount,
            skippedCount: normalizedProductIds.length - validProductIdSet.size
        };
    }

    async validateProductsForDomesticPublish(client, companyId, productIds) {
        await this.ensureProductComplianceDocumentsTable(client);

        const normalizedProductIds = this._normalizeUuidArray(productIds);
        if (normalizedProductIds.length === 0) {
            return {
                success: false,
                marketCode: DEFAULT_DOMESTIC_MARKET_CODE,
                requiredDocuments: [],
                missingByProduct: []
            };
        }

        const productsResult = await client.query(
            `
            SELECT id, sku, name
            FROM products
            WHERE company_id = $1
              AND id = ANY($2::uuid[])
            `,
            [companyId, normalizedProductIds]
        );
        const products = productsResult.rows;

        if (products.length === 0) {
            return {
                success: false,
                marketCode: DEFAULT_DOMESTIC_MARKET_CODE,
                requiredDocuments: [],
                missingByProduct: []
            };
        }

        const domesticMarketCode = await this.resolveCompanyDomesticMarketCode(client, companyId);
        const requiredDocuments = await this.listRequiredDocuments(client, domesticMarketCode);

        if (requiredDocuments.length === 0) {
            return {
                success: true,
                marketCode: domesticMarketCode,
                requiredDocuments: [],
                missingByProduct: []
            };
        }

        await this.ensureRequiredDocumentPlaceholders(client, companyId, domesticMarketCode, requiredDocuments);

        const requiredCodes = requiredDocuments.map((doc) => this._normalizeDocumentCode(doc.code)).filter(Boolean);

        const documentRowsResult = await client.query(
            `
            SELECT id, LOWER(document_code) AS document_code, document_name, status, storage_key
            FROM compliance_documents
            WHERE company_id = $1
              AND UPPER(market_code) = $2
              AND LOWER(COALESCE(document_code, '')) = ANY($3)
            `,
            [companyId, domesticMarketCode, requiredCodes]
        );

        const documentsByCode = new Map();
        for (const doc of documentRowsResult.rows) {
            const code = this._normalizeDocumentCode(doc.document_code);
            if (!code || documentsByCode.has(code)) continue;
            documentsByCode.set(code, doc);
        }

        const documentIds = documentRowsResult.rows.map((row) => row.id);
        const linksByProductAndDocument = new Map();

        if (documentIds.length > 0) {
            const linkRowsResult = await client.query(
                `
                SELECT product_id, compliance_document_id, storage_key_snapshot
                FROM product_compliance_documents
                WHERE company_id = $1
                  AND product_id = ANY($2::uuid[])
                  AND compliance_document_id = ANY($3::uuid[])
                `,
                [companyId, products.map((product) => product.id), documentIds]
            );

            for (const row of linkRowsResult.rows) {
                const key = `${row.product_id}::${row.compliance_document_id}`;
                linksByProductAndDocument.set(key, row);
            }
        }

        const missingByProduct = [];

        for (const product of products) {
            const missingDocuments = [];

            for (const template of requiredDocuments) {
                const normalizedCode = this._normalizeDocumentCode(template.code);
                const matchedDocument = documentsByCode.get(normalizedCode);
                if (!matchedDocument) {
                    missingDocuments.push({
                        document_code: normalizedCode,
                        document_name: template.name,
                        reason: 'MISSING_DOCUMENT'
                    });
                    continue;
                }

                const linkKey = `${product.id}::${matchedDocument.id}`;
                const linkedRow = linksByProductAndDocument.get(linkKey) || null;
                const normalizedStatus = this._normalizeDocumentCode(matchedDocument.status);
                const hasUploadedFile = Boolean(
                    String(matchedDocument.storage_key || '').trim() ||
                    String(linkedRow?.storage_key_snapshot || '').trim()
                );

                if (!linkedRow) {
                    missingDocuments.push({
                        document_code: normalizedCode,
                        document_name: matchedDocument.document_name || template.name,
                        reason: 'NOT_LINKED_TO_PRODUCT'
                    });
                    continue;
                }

                if (!DONE_DOCUMENT_STATUSES.has(normalizedStatus)) {
                    missingDocuments.push({
                        document_code: normalizedCode,
                        document_name: matchedDocument.document_name || template.name,
                        reason: 'DOCUMENT_NOT_UPLOADED'
                    });
                    continue;
                }

                if (!hasUploadedFile) {
                    missingDocuments.push({
                        document_code: normalizedCode,
                        document_name: matchedDocument.document_name || template.name,
                        reason: 'MISSING_STORAGE_PATH'
                    });
                }
            }

            if (missingDocuments.length > 0) {
                missingByProduct.push({
                    product_id: product.id,
                    product_code: product.sku,
                    product_name: product.name,
                    missing_documents: missingDocuments
                });
            }
        }

        return {
            success: missingByProduct.length === 0,
            marketCode: domesticMarketCode,
            requiredDocuments,
            missingByProduct
        };
    }

    createMissingDocumentsError(validationResult) {
        const failedProductCount = Array.isArray(validationResult?.missingByProduct)
            ? validationResult.missingByProduct.length
            : 0;
        const marketCode = this._normalizeMarketCode(validationResult?.marketCode || DEFAULT_DOMESTIC_MARKET_CODE);

        const error = new Error(
            `Cannot publish because required domestic documents are missing for ${failedProductCount} product(s).`
        );
        error.statusCode = 400;
        error.code = 'MISSING_DOMESTIC_DOCUMENTS';
        error.details = {
            market_code: marketCode,
            required_documents: validationResult?.requiredDocuments || [],
            missing_by_product: validationResult?.missingByProduct || []
        };
        return error;
    }
}

module.exports = new DomesticComplianceService();
