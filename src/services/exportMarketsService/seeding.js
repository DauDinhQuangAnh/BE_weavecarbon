const { randomUUID } = require('crypto');
const {
    SUPPORTED_TARGET_MARKETS_SET,
    normalizeTargetMarkets
} = require('../../constants/targetMarkets');
const { normalizeDocumentCode } = require('./normalizers');
const {
    DEFAULT_MARKET_CODES,
    MATERIAL_CERTIFICATION_DOCUMENTS,
    resolveMarketName,
    getRequiredDocumentsForMarket
} = require('./marketRequirements');

async function ensureExportMarkets(client, companyId) {
    const targetMarketsResult = await client.query(
        'SELECT target_markets FROM companies WHERE id = $1 LIMIT 1',
        [companyId]
    );

    const companyTargetMarkets = Array.isArray(targetMarketsResult.rows[0]?.target_markets)
        ? targetMarketsResult.rows[0].target_markets
        : [];

    const normalizedSelectedCodes = normalizeTargetMarkets(
        companyTargetMarkets.length > 0 ? companyTargetMarkets : DEFAULT_MARKET_CODES
    );

    const requestedCodes = normalizedSelectedCodes.length > 0
        ? normalizedSelectedCodes
        : DEFAULT_MARKET_CODES.filter(code => SUPPORTED_TARGET_MARKETS_SET.has(code));

    if (requestedCodes.length === 0) {
        return [];
    }

    const getMarketsByCodesQuery = `
        SELECT
            em.id,
            em.market_code,
            em.market_name,
            em.status,
            em.score,
            em.verification_status,
            em.verification_date,
            em.verification_body,
            em.verification_notes,
            em.created_at,
            em.updated_at
        FROM export_markets em
        WHERE em.company_id = $1
          AND UPPER(em.market_code) = ANY($2)
        ORDER BY em.market_name ASC
    `;

    let marketsResult = await client.query(getMarketsByCodesQuery, [companyId, requestedCodes]);

    const existingCodes = new Set(
        marketsResult.rows.map(row => String(row.market_code || '').trim().toUpperCase())
    );

    const missingCodes = requestedCodes.filter(code => !existingCodes.has(code));

    if (missingCodes.length > 0) {
        for (const code of missingCodes) {
            await client.query(
                `
                INSERT INTO export_markets (
                    company_id, market_code, market_name, status, score, created_at, updated_at
                )
                VALUES ($1, $2, $3, 'draft', 0, NOW(), NOW())
                ON CONFLICT (company_id, market_code) DO NOTHING
                `,
                [companyId, code, resolveMarketName(code)]
            );
        }

        marketsResult = await client.query(getMarketsByCodesQuery, [companyId, requestedCodes]);
    }

    return marketsResult.rows;
}

async function ensureRequiredDocuments(client, companyId, markets) {
    const marketCodes = markets.map(m => String(m.market_code || '').trim().toUpperCase());
    if (marketCodes.length === 0) return;

    const existingDocsResult = await client.query(
        `
        SELECT UPPER(market_code) AS market_code, document_code
        FROM compliance_documents
        WHERE company_id = $1
          AND UPPER(market_code) = ANY($2)
          AND document_code IS NOT NULL
        `,
        [companyId, marketCodes]
    );

    const existingKeys = new Set(
        existingDocsResult.rows.map(d => `${d.market_code}::${normalizeDocumentCode(d.document_code)}`)
    );

    for (const market of markets) {
        const marketCode = String(market.market_code || '').trim().toUpperCase();
        const requiredDocs = getRequiredDocumentsForMarket(marketCode);

        for (const doc of requiredDocs) {
            const normalizedDocCode = normalizeDocumentCode(doc.code);
            const key = `${marketCode}::${normalizedDocCode}`;
            if (existingKeys.has(key)) {
                continue;
            }

            await client.query(
                `
                INSERT INTO compliance_documents (
                    id, company_id, market_code, document_code, document_name,
                    status, created_at, updated_at
                )
                SELECT $1, $2, $3, $4, $5, 'missing', NOW(), NOW()
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM compliance_documents
                    WHERE company_id = $2
                      AND UPPER(market_code) = UPPER($3)
                      AND document_code = $4
                )
                `,
                [randomUUID(), companyId, market.market_code, normalizedDocCode, doc.name]
            );

            existingKeys.add(key);
        }
    }
}

async function ensureMaterialCertificationDocuments(client, companyId, markets) {
    const marketCodes = markets.map(m => String(m.market_code || '').trim().toUpperCase());
    if (marketCodes.length === 0) return;

    const existingDocsResult = await client.query(
        `
        SELECT UPPER(market_code) AS market_code, document_code
        FROM compliance_documents
        WHERE company_id = $1
          AND UPPER(market_code) = ANY($2)
          AND document_code IS NOT NULL
        `,
        [companyId, marketCodes]
    );

    const existingKeys = new Set(
        existingDocsResult.rows.map(d => `${d.market_code}::${normalizeDocumentCode(d.document_code)}`)
    );

    for (const market of markets) {
        const marketCode = String(market.market_code || '').trim().toUpperCase();

        for (const template of MATERIAL_CERTIFICATION_DOCUMENTS) {
            const normalizedDocumentCode = normalizeDocumentCode(template.code);
            const key = `${marketCode}::${normalizedDocumentCode}`;
            if (existingKeys.has(key)) {
                continue;
            }

            await client.query(
                `
                INSERT INTO compliance_documents (
                    id, company_id, market_code, document_code, document_name,
                    status, created_at, updated_at
                )
                SELECT $1, $2, $3, $4, $5, 'missing', NOW(), NOW()
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM compliance_documents
                    WHERE company_id = $2
                      AND UPPER(market_code) = UPPER($3)
                      AND document_code = $4
                )
                `,
                [
                    randomUUID(),
                    companyId,
                    market.market_code,
                    normalizedDocumentCode,
                    template.name
                ]
            );

            existingKeys.add(key);
        }
    }
}

async function ensureMarketsAndRequiredDocuments(client, companyId) {
    const markets = await ensureExportMarkets(client, companyId);
    if (markets.length === 0) {
        return [];
    }

    await ensureRequiredDocuments(client, companyId, markets);
    await ensureMaterialCertificationDocuments(client, companyId, markets);
    return markets;
}

module.exports = {
    ensureMarketsAndRequiredDocuments,
    ensureExportMarkets,
    ensureRequiredDocuments,
    ensureMaterialCertificationDocuments
};
