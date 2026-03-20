const pool = require('../config/database');
const { randomUUID } = require('crypto');
const {
    SUPPORTED_TARGET_MARKETS_SET,
    normalizeTargetMarkets
} = require('../constants/targetMarkets');
const { getSchemaCapabilities } = require('../config/schemaCapabilities');
const { EMISSION_FACTORS_CACHE_TTL_MS, READ_CACHE_TTL_MS } = require('../config/runtime');
const domesticComplianceService = require('./domesticComplianceService');
const reportJobQueue = require('./reportJobQueue');
const TtlCache = require('../utils/ttlCache');

const DEFAULT_MARKET_CODES = ['VN', 'EU', 'US', 'JP', 'KR', 'AU', 'ASEAN'];

const DEFAULT_REQUIRED_DOCUMENTS = [
    {
        code: 'carbon_footprint_report',
        name: 'Carbon Footprint Report',
        document_type: 'report',
        regulation_reference: 'ISO 14067'
    },
    {
        code: 'product_traceability',
        name: 'Product Traceability Document',
        document_type: 'declaration',
        regulation_reference: 'OECD Due Diligence Guidance'
    },
    {
        code: 'import_compliance_declaration',
        name: 'Import Compliance Declaration',
        document_type: 'declaration',
        regulation_reference: 'Import/Customs Compliance'
    }
];

const MATERIAL_CERTIFICATION_DOCUMENTS = [
    {
        code: 'cert_gots',
        name: 'GOTS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Global Organic Textile Standard (GOTS)'
    },
    {
        code: 'cert_oeko_tex',
        name: 'OEKO-TEX Certificate',
        document_type: 'certificate',
        regulation_reference: 'OEKO-TEX Standard 100'
    },
    {
        code: 'cert_grs',
        name: 'GRS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Global Recycled Standard (GRS)'
    },
    {
        code: 'cert_bci_cotton',
        name: 'BCI Cotton Certificate',
        document_type: 'certificate',
        regulation_reference: 'Better Cotton Initiative (BCI)'
    },
    {
        code: 'cert_fsc',
        name: 'FSC Certificate',
        document_type: 'certificate',
        regulation_reference: 'Forest Stewardship Council (FSC)'
    },
    {
        code: 'cert_rcs',
        name: 'RCS Certificate',
        document_type: 'certificate',
        regulation_reference: 'Recycled Claim Standard (RCS)'
    }
];

const MARKET_REQUIREMENTS_BY_CODE = {
    VN: {
        market_name: 'Vietnam',
        required_documents: [
            {
                code: 'eia',
                name: 'Environmental Impact Assessment (EIA)',
                document_type: 'assessment',
                regulation_reference: 'Vietnam Law on Environmental Protection 2020'
            },
            {
                code: 'ghg_inventory_vn',
                name: 'GHG Inventory / MRV Declaration',
                document_type: 'report',
                regulation_reference: 'Decree 06/2022/ND-CP'
            },
            {
                code: 'local_compliance',
                name: 'Local Compliance Declaration',
                document_type: 'declaration',
                regulation_reference: 'Vietnam domestic compliance'
            }
        ]
    },
    EU: {
        market_name: 'European Union',
        required_documents: [
            {
                code: 'cbam_declaration',
                name: 'CBAM Declaration Form',
                document_type: 'declaration',
                regulation_reference: 'EU Regulation (EU) 2023/956'
            },
            {
                code: 'dpp',
                name: 'Digital Product Passport (DPP)',
                document_type: 'report',
                regulation_reference: 'EU Ecodesign for Sustainable Products Regulation'
            },
            {
                code: 'supply_chain_map',
                name: 'Supply Chain Map',
                document_type: 'assessment',
                regulation_reference: 'EU supply chain due diligence'
            }
        ]
    },
    US: {
        market_name: 'United States',
        required_documents: [
            {
                code: 'carbon_report',
                name: 'Carbon Footprint Report',
                document_type: 'report',
                regulation_reference: 'California Climate Disclosure'
            },
            {
                code: 'ca_prop65',
                name: 'CA Prop 65 Compliance',
                document_type: 'certificate',
                regulation_reference: 'California Proposition 65'
            },
            {
                code: 'product_label_compliance',
                name: 'Product Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'US labeling requirements'
            }
        ]
    },
    JP: {
        market_name: 'Japan',
        required_documents: [
            {
                code: 'j_label_cert',
                name: 'J-Label Certification',
                document_type: 'certificate',
                regulation_reference: 'Japan eco-label guidance'
            },
            {
                code: 'jp_import_docs',
                name: 'Japan Import Documentation',
                document_type: 'declaration',
                regulation_reference: 'Japan Customs'
            },
            {
                code: 'carbon_label_jp',
                name: 'Carbon Footprint Label (JP)',
                document_type: 'report',
                regulation_reference: 'Japan CFP Program'
            }
        ]
    },
    KR: {
        market_name: 'South Korea',
        required_documents: [
            {
                code: 'kc_certification',
                name: 'KC Certification',
                document_type: 'certificate',
                regulation_reference: 'Korea Certification (KC)'
            },
            {
                code: 'kr_eco_label',
                name: 'Korea Eco Label',
                document_type: 'certificate',
                regulation_reference: 'Korea Eco-Label Program'
            },
            {
                code: 'kr_import_clearance',
                name: 'Import Clearance Document',
                document_type: 'declaration',
                regulation_reference: 'Korea Customs Service'
            }
        ]
    },
    AU: {
        market_name: 'Australia',
        required_documents: [
            {
                code: 'aus_product_stewardship',
                name: 'Product Stewardship Declaration',
                document_type: 'declaration',
                regulation_reference: 'Australian Product Stewardship framework'
            },
            {
                code: 'aus_carbon_disclosure',
                name: 'Carbon Disclosure Summary',
                document_type: 'report',
                regulation_reference: 'NGER / Australian climate reporting'
            },
            {
                code: 'aus_import_compliance',
                name: 'Australian Import Compliance Declaration',
                document_type: 'declaration',
                regulation_reference: 'Australian Border Force import rules'
            }
        ]
    },
    ASEAN: {
        market_name: 'ASEAN',
        required_documents: [
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            },
            {
                code: 'asean_label_compliance',
                name: 'ASEAN Labeling Compliance',
                document_type: 'declaration',
                regulation_reference: 'ASEAN product labeling baseline'
            },
            {
                code: 'asean_carbon_summary',
                name: 'ASEAN Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'ASEAN sustainability reporting baseline'
            }
        ]
    },
    TH: {
        market_name: 'Thailand',
        required_documents: [
            {
                code: 'thai_product_registration',
                name: 'Thai Product Registration',
                document_type: 'declaration',
                regulation_reference: 'Thai import registration'
            },
            {
                code: 'thai_labeling',
                name: 'Thai Language Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Thai labeling requirements'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    SG: {
        market_name: 'Singapore',
        required_documents: [
            {
                code: 'sg_product_safety',
                name: 'Singapore Product Safety Declaration',
                document_type: 'declaration',
                regulation_reference: 'CPSR (Consumer Protection Safety Requirements)'
            },
            {
                code: 'sg_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'Singapore sustainability disclosure baseline'
            },
            {
                code: 'importer_authorization',
                name: 'Importer Authorization Letter',
                document_type: 'declaration',
                regulation_reference: 'Singapore customs import authorization'
            }
        ]
    },
    MY: {
        market_name: 'Malaysia',
        required_documents: [
            {
                code: 'my_import_permit',
                name: 'Malaysia Import Permit',
                document_type: 'declaration',
                regulation_reference: 'Royal Malaysian Customs import control'
            },
            {
                code: 'my_label_compliance',
                name: 'Malaysia Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Malaysia product labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    ID: {
        market_name: 'Indonesia',
        required_documents: [
            {
                code: 'id_nib_import',
                name: 'NIB / Import Registration',
                document_type: 'declaration',
                regulation_reference: 'Indonesia OSS/NIB import registration'
            },
            {
                code: 'id_label_compliance',
                name: 'Bahasa Indonesia Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Indonesia mandatory labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    PH: {
        market_name: 'Philippines',
        required_documents: [
            {
                code: 'ph_import_clearance',
                name: 'Philippines Import Clearance',
                document_type: 'declaration',
                regulation_reference: 'Philippines Bureau of Customs'
            },
            {
                code: 'ph_label_compliance',
                name: 'Philippines Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Philippines product labeling'
            },
            {
                code: 'asean_origin_cert',
                name: 'ASEAN Certificate of Origin',
                document_type: 'certificate',
                regulation_reference: 'ATIGA Rules of Origin'
            }
        ]
    },
    CA: {
        market_name: 'Canada',
        required_documents: [
            {
                code: 'ca_importer_record',
                name: 'Importer of Record Declaration',
                document_type: 'declaration',
                regulation_reference: 'CBSA import requirements'
            },
            {
                code: 'ca_textile_label',
                name: 'Canada Textile Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Textile Labelling Act (Canada)'
            },
            {
                code: 'ca_carbon_disclosure',
                name: 'Carbon Disclosure Summary',
                document_type: 'report',
                regulation_reference: 'Canadian sustainability disclosure practices'
            }
        ]
    },
    UK: {
        market_name: 'United Kingdom',
        required_documents: [
            {
                code: 'uk_import_declaration',
                name: 'UK Import Declaration',
                document_type: 'declaration',
                regulation_reference: 'UK customs import declaration'
            },
            {
                code: 'uk_textile_label',
                name: 'UK Textile Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'UK product and textile labeling'
            },
            {
                code: 'uk_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'UK climate disclosure baseline'
            }
        ]
    },
    CN: {
        market_name: 'China',
        required_documents: [
            {
                code: 'cn_import_registration',
                name: 'China Import Registration',
                document_type: 'declaration',
                regulation_reference: 'China customs import registration'
            },
            {
                code: 'cn_label_compliance',
                name: 'China Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'China GB labeling standards'
            },
            {
                code: 'cn_carbon_declaration',
                name: 'Carbon Declaration Summary',
                document_type: 'report',
                regulation_reference: 'China low-carbon disclosure baseline'
            }
        ]
    },
    IN: {
        market_name: 'India',
        required_documents: [
            {
                code: 'in_import_export_code',
                name: 'Importer-Exporter Code (IEC) Compliance',
                document_type: 'declaration',
                regulation_reference: 'DGFT IEC requirements'
            },
            {
                code: 'in_label_compliance',
                name: 'India Label Compliance',
                document_type: 'declaration',
                regulation_reference: 'Legal Metrology (Packaged Commodities) Rules'
            },
            {
                code: 'in_carbon_summary',
                name: 'Carbon Reporting Summary',
                document_type: 'report',
                regulation_reference: 'India sustainability disclosure baseline'
            }
        ]
    }
};

const DOCUMENT_UPLOAD_DONE_STATUSES = new Set(['uploaded', 'approved']);

class ExportMarketsService {
    constructor() {
        this.marketListCache = new TtlCache({ ttlMs: READ_CACHE_TTL_MS });
        this.emissionFactorsCache = new TtlCache({ ttlMs: EMISSION_FACTORS_CACHE_TTL_MS });
    }

    invalidateListCache(companyId) {
        this.marketListCache.delete(companyId);
    }

    /**
     * List all market compliance data for a company
     * Returns market cards with documents, product_scope, carbon_data, recommendations
     */
    async listMarkets(companyId) {
        const cached = this.marketListCache.get(companyId);
        if (typeof cached !== 'undefined') {
            return cached;
        }

        const client = await pool.connect();
        try {
            const markets = await this._listCompanyMarkets(client, companyId);
            if (markets.length === 0) {
                return [];
            }

            const marketIds = markets.map((market) => market.id).filter(Boolean);
            const marketCodes = markets.map(m => String(m.market_code || '').trim().toUpperCase());
            const docsQuery = `
                SELECT 
                    cd.id, cd.market_code, cd.document_code, cd.document_name,
                    cd.status, cd.storage_provider, cd.storage_key,
                    cd.original_filename, cd.mime_type, cd.file_size_bytes,
                    cd.checksum_sha256, cd.uploaded_by, cd.uploaded_at,
                    cd.valid_from, cd.valid_to, cd.created_at, cd.updated_at,
                    COALESCE(linked.linked_product_ids, ARRAY[]::uuid[]) AS linked_product_ids
                FROM compliance_documents cd
                LEFT JOIN (
                    SELECT
                        pcd.compliance_document_id,
                        ARRAY_AGG(DISTINCT pcd.product_id) AS linked_product_ids
                    FROM product_compliance_documents pcd
                    WHERE pcd.company_id = $1
                    GROUP BY pcd.compliance_document_id
                ) linked ON linked.compliance_document_id = cd.id
                WHERE cd.company_id = $1
                  AND UPPER(cd.market_code) = ANY($2)
                ORDER BY cd.created_at DESC
            `;
            const scopeQuery = `
                SELECT 
                    mps.id, mps.market_id, mps.product_id, mps.hs_code, mps.notes,
                    p.name as product_name, p.sku, p.total_co2e
                FROM market_product_scope mps
                JOIN products p ON p.id = mps.product_id
                WHERE mps.market_id = ANY($1)
                ORDER BY p.name ASC
            `;
            const carbonQuery = `
                SELECT 
                    mcd.id, mcd.market_id, mcd.scope, mcd.value, mcd.unit,
                    mcd.methodology, mcd.data_source, mcd.reporting_period
                FROM market_carbon_data mcd
                WHERE mcd.market_id = ANY($1)
                ORDER BY mcd.scope ASC
            `;
            const recsQuery = `
                SELECT 
                    mr.id, mr.market_id, mr.type, mr.missing_item,
                    mr.regulatory_reason, mr.impact_if_missing,
                    mr.priority, mr.status, mr.action_taken,
                    mr.document_id, mr.created_at
                FROM market_recommendations mr
                WHERE mr.market_id = ANY($1)
                ORDER BY mr.priority ASC, mr.created_at DESC
            `;

            const [
                docsResult,
                scopeResult,
                carbonResult,
                recsResult,
                emissionFactors
            ] = await Promise.all([
                pool.query(docsQuery, [companyId, marketCodes]),
                marketIds.length > 0
                    ? pool.query(scopeQuery, [marketIds])
                    : Promise.resolve({ rows: [] }),
                marketIds.length > 0
                    ? pool.query(carbonQuery, [marketIds])
                    : Promise.resolve({ rows: [] }),
                marketIds.length > 0
                    ? pool.query(recsQuery, [marketIds])
                    : Promise.resolve({ rows: [] }),
                this._getEmissionFactors()
            ]);

            // Group sub-data by market_id (or market_code for docs)
            const docsMap = {};
            const marketByCode = new Map(
                markets.map(m => [String(m.market_code || '').trim().toUpperCase(), m])
            );
            for (const d of docsResult.rows) {
                const market = marketByCode.get(String(d.market_code || '').trim().toUpperCase());
                if (market) {
                    if (!docsMap[market.id]) docsMap[market.id] = [];
                    docsMap[market.id].push(d);
                }
            }
            const scopeMap = this._groupBy(scopeResult.rows, 'market_id');
            const carbonMap = this._groupBy(carbonResult.rows, 'market_id');
            const recsMap = this._groupBy(recsResult.rows, 'market_id');

            const payload = markets.map(market => {
                const marketCode = String(market.market_code || '').trim().toUpperCase();
                const marketDocs = docsMap[market.id] || [];

                const requiredTemplates = this._getRequiredDocumentsForMarket(marketCode);
                const requiredCodeSet = new Set(requiredTemplates.map(d => this._normalizeDocumentCode(d.code)));

                const requiredDocsByCode = new Map();
                for (const doc of marketDocs) {
                    const normalizedDocumentCode = this._normalizeDocumentCode(doc.document_code);
                    if (normalizedDocumentCode && !requiredDocsByCode.has(normalizedDocumentCode)) {
                        requiredDocsByCode.set(normalizedDocumentCode, doc);
                    }
                }

                const requiredDocuments = requiredTemplates.map(template => {
                    const normalizedTemplateCode = this._normalizeDocumentCode(template.code);
                    const existing = requiredDocsByCode.get(normalizedTemplateCode) || null;
                    const status = existing?.status || 'missing';

                    return {
                        id: existing?.id || null,
                        name: existing?.document_name || template.name,
                        document_code: template.code,
                        document_name: existing?.document_name || template.name,
                        required: true,
                        status,
                        valid_to: existing?.valid_to || null,
                        uploaded_by: existing?.uploaded_by || null,
                        uploaded_at: existing?.uploaded_at || null,
                        linked_products: Array.isArray(existing?.linked_product_ids)
                            ? existing.linked_product_ids
                            : [],
                        download_url: existing?.storage_key
                            ? `/api/export/markets/${market.market_code}/documents/${existing.id}/download`
                            : null
                    };
                });

                const requiredDocumentsUploadedCount = requiredDocuments.filter(d =>
                    DOCUMENT_UPLOAD_DONE_STATUSES.has(String(d.status || '').toLowerCase())
                ).length;

                const documentsUploadedCount = marketDocs.filter(d =>
                    DOCUMENT_UPLOAD_DONE_STATUSES.has(String(d.status || '').toLowerCase())
                ).length;

                const persistedRecommendations = (recsMap[market.id] || []).map(r => ({
                    recommendation_id: r.id,
                    type: r.type || 'document',
                    missing_item: r.missing_item,
                    regulatory_reason: r.regulatory_reason,
                    impact_if_missing: r.impact_if_missing || 'Thiếu thông tin ảnh hưởng nếu còn thiếu.',
                    priority: r.priority,
                    status: r.status,
                    document_id: r.document_id || null
                }));

                const persistedRecommendationKeySet = new Set(
                    persistedRecommendations
                        .filter(rec => String(rec.type || '').toLowerCase() === 'document')
                        .map(rec => this._normalizeDocumentCode(rec.missing_item || rec.document_id || ''))
                        .filter(Boolean)
                );

                const templateByCode = new Map(
                    requiredTemplates.map(template => [
                        this._normalizeDocumentCode(template.code),
                        template
                    ])
                );

                const autoGeneratedRecommendations = requiredDocuments
                    .filter(doc => !DOCUMENT_UPLOAD_DONE_STATUSES.has(String(doc.status || '').toLowerCase()))
                    .map((doc) => {
                        const normalizedDocCode = this._normalizeDocumentCode(doc.document_code || doc.document_name || '');
                        if (!normalizedDocCode || persistedRecommendationKeySet.has(normalizedDocCode)) {
                            return null;
                        }

                        const template = templateByCode.get(normalizedDocCode);
                        const regulationReference = template?.regulation_reference || 'Market compliance requirement';

                        return {
                            recommendation_id: `auto-doc-${market.id || marketCode}-${normalizedDocCode}`,
                            type: 'document',
                            missing_item: doc.document_name || template?.name || normalizedDocCode,
                            regulatory_reason: `Thiếu tài liệu bắt buộc theo yêu cầu: ${regulationReference}.`,
                            impact_if_missing: 'Chưa đủ điều kiện xuất khẩu cho thị trường này.',
                            priority: 'mandatory',
                            status: 'active',
                            document_id: doc.id || doc.document_code || null,
                            auto_generated: true
                        };
                    })
                    .filter(Boolean);

                return {
                    id: market.id,
                    market_code: market.market_code,
                    market_name: market.market_name,
                    status: market.status,
                    score: parseFloat(market.score) || 0,
                    verification_status: market.verification_status,
                    verification_date: market.verification_date,
                    verification_body: market.verification_body,
                    verification_notes: market.verification_notes,
                    required_documents: requiredDocuments,
                    required_documents_count: requiredDocuments.length,
                    required_documents_uploaded_count: requiredDocumentsUploadedCount,
                    required_documents_missing_count: requiredDocuments.length - requiredDocumentsUploadedCount,
                    documents_total_count: marketDocs.length,
                    documents_uploaded_count: documentsUploadedCount,
                    documents_missing_count: marketDocs.filter(d => String(d.status || '').toLowerCase() === 'missing').length,
                    document_requirements: requiredTemplates.map((doc, index) => ({
                        id: `${marketCode}:${index + 1}`,
                        market_code: marketCode,
                        document_code: doc.code,
                        document_name: doc.name,
                        document_type: doc.document_type || null,
                        required: true,
                        regulation_reference: doc.regulation_reference || null
                    })),
                    documents: marketDocs.map(d => ({
                        id: d.id,
                        name: d.document_name,
                        document_code: d.document_code,
                        document_name: d.document_name,
                        required: requiredCodeSet.has(this._normalizeDocumentCode(d.document_code)),
                        status: d.status,
                        valid_to: d.valid_to || null,
                        uploaded_by: d.uploaded_by || null,
                        uploaded_at: d.uploaded_at || null,
                        storage_provider: d.storage_provider,
                        storage_key: d.storage_key,
                        original_filename: d.original_filename,
                        mime_type: d.mime_type,
                        file_size_bytes: d.file_size_bytes,
                        checksum_sha256: d.checksum_sha256,
                        valid_from: d.valid_from,
                        updated_at: d.updated_at,
                        linked_products: Array.isArray(d.linked_product_ids) ? d.linked_product_ids : [],
                        download_url: d.storage_key
                            ? `/api/export/markets/${market.market_code}/documents/${d.id}/download`
                            : null
                    })),
                    product_scope: (scopeMap[market.id] || []).map(s => ({
                        id: s.id,
                        product_id: s.product_id,
                        product_name: s.product_name,
                        sku: s.sku,
                        total_co2e: s.total_co2e,
                        hs_code: s.hs_code,
                        notes: s.notes
                    })),
                    carbon_data: (carbonMap[market.id] || []).map(c => ({
                        id: c.id,
                        scope: c.scope,
                        value: parseFloat(c.value) || 0,
                        unit: c.unit,
                        methodology: c.methodology,
                        data_source: c.data_source,
                        reporting_period: c.reporting_period
                    })),
                    recommendations: [
                        ...persistedRecommendations,
                        ...autoGeneratedRecommendations
                    ],
                    emission_factors: emissionFactors.map(ef => ({
                        id: ef.id,
                        category: ef.category,
                        subcategory: ef.subcategory,
                        factor_value: parseFloat(ef.factor_value),
                        unit: ef.unit,
                        source: ef.source,
                        version: ef.version
                    })),
                    created_at: market.created_at,
                    updated_at: market.updated_at
                };
            });
            this.marketListCache.set(companyId, payload);
            return payload;
        } finally {
            client.release();
        }
    }

    /**
     * Perform action on a recommendation
     */
    async performRecommendationAction(companyId, marketCode, recommendationId, action) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify market belongs to company
            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            // Verify recommendation belongs to market
            const recQuery = `
                SELECT id, status FROM market_recommendations
                WHERE id = $1 AND market_id = $2
            `;
            const recResult = await client.query(recQuery, [recommendationId, market.id]);
            if (recResult.rows.length === 0) {
                return { success: false, error: 'RECOMMENDATION_NOT_FOUND' };
            }

            // Map action to new status (active|completed|ignored)
            const actionStatusMap = {
                'start': 'active',
                'complete': 'completed',
                'mark_completed': 'completed',
                'dismiss': 'ignored',
                'reset': 'active'
            };

            const newStatus = actionStatusMap[action];
            if (!newStatus) {
                return { success: false, error: 'INVALID_ACTION', message: `Invalid action: ${action}` };
            }

            const updateQuery = `
                UPDATE market_recommendations
                SET status = $1, action_taken = $2, updated_at = NOW()
                WHERE id = $3
                RETURNING id, status, action_taken, updated_at
            `;
            const updateResult = await client.query(updateQuery, [newStatus, action, recommendationId]);

            // Recalculate market score
            await this._recalculateMarketScore(client, market.id, companyId, marketCode);

            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return {
                success: true,
                data: updateResult.rows[0]
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Add product to market scope
     */
    async addProductToScope(companyId, marketCode, productData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            // Verify product belongs to company
            const productCheck = await client.query(
                'SELECT id FROM products WHERE id = $1 AND company_id = $2',
                [productData.product_id, companyId]
            );
            if (productCheck.rows.length === 0) {
                return { success: false, error: 'PRODUCT_NOT_FOUND' };
            }

            const insertQuery = `
                INSERT INTO market_product_scope (market_id, product_id, hs_code, notes)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (market_id, product_id) DO UPDATE
                SET hs_code = EXCLUDED.hs_code, notes = EXCLUDED.notes, updated_at = NOW()
                RETURNING id, product_id, hs_code, notes
            `;
            const insertResult = await client.query(insertQuery, [
                market.id,
                productData.product_id,
                productData.hs_code || null,
                productData.notes || null
            ]);

            await this._recalculateMarketScore(client, market.id, companyId, marketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true, data: insertResult.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update product in market scope
     */
    async updateProductInScope(companyId, marketCode, productId, updateData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            const updateQuery = `
                UPDATE market_product_scope
                SET hs_code = COALESCE($1, hs_code),
                    notes = COALESCE($2, notes),
                    updated_at = NOW()
                WHERE market_id = $3 AND product_id = $4
                RETURNING id, product_id, hs_code, notes
            `;
            const updateResult = await client.query(updateQuery, [
                updateData.hs_code,
                updateData.notes,
                market.id,
                productId
            ]);

            if (updateResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_SCOPE_NOT_FOUND' };
            }

            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true, data: updateResult.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Remove product from market scope
     */
    async removeProductFromScope(companyId, marketCode, productId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            const deleteQuery = `
                DELETE FROM market_product_scope
                WHERE market_id = $1 AND product_id = $2
                RETURNING id
            `;
            const deleteResult = await client.query(deleteQuery, [market.id, productId]);

            if (deleteResult.rows.length === 0) {
                return { success: false, error: 'PRODUCT_SCOPE_NOT_FOUND' };
            }

            await this._recalculateMarketScore(client, market.id, companyId, marketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update carbon data for a specific scope in a market
     */
    async updateCarbonData(companyId, marketCode, scope, carbonData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            const upsertQuery = `
                INSERT INTO market_carbon_data (market_id, scope, value, unit, methodology, data_source, reporting_period)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (market_id, scope) DO UPDATE
                SET value = EXCLUDED.value,
                    unit = EXCLUDED.unit,
                    methodology = EXCLUDED.methodology,
                    data_source = EXCLUDED.data_source,
                    reporting_period = EXCLUDED.reporting_period,
                    updated_at = NOW()
                RETURNING id, scope, value, unit, methodology, data_source, reporting_period
            `;
            const result = await client.query(upsertQuery, [
                market.id,
                scope,
                carbonData.value,
                carbonData.unit || 'tCO2e',
                carbonData.methodology || null,
                carbonData.data_source || null,
                carbonData.reporting_period || null
            ]);

            await this._recalculateMarketScore(client, market.id, companyId, marketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true, data: result.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Upload document for a market
     * Note: Actual file upload to storage should be handled by middleware (multer, etc.)
     */
    async uploadDocument(companyId, marketCode, documentId, userId, fileData, options = {}) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }
            const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();

            // Sanitize filename (prevent path traversal)
            const safeFilename = (fileData.original_filename || 'document')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .replace(/\.\./g, '_');

            // Generate tenant-aware storage key
            const timestamp = Date.now();
            const explicitStorageKey = String(
                fileData.storage_key ||
                fileData.document_path ||
                fileData.file_path ||
                ''
            )
                .trim()
                .replace(/\\/g, '/')
                .replace(/\.\./g, '_')
                .replace(/^\/+/, '');
            const storageKey = explicitStorageKey ||
                `compliance/${companyId}/${normalizedMarketCode}/${documentId}/${timestamp}_${safeFilename}`;
            const normalizedDocumentStatus = this._toDocumentStatus(fileData.status);

            // Check if document exists
            const docCheck = await client.query(
                'SELECT id FROM compliance_documents WHERE id = $1 AND company_id = $2 AND UPPER(market_code) = $3',
                [documentId, companyId, normalizedMarketCode]
            );

            let result;
            if (docCheck.rows.length > 0) {
                // Update existing document
                const updateQuery = `
                    UPDATE compliance_documents
                    SET status = $1,
                        storage_provider = $2,
                        storage_bucket = $3,
                        storage_key = $4,
                        original_filename = $5,
                        mime_type = $6,
                        file_size_bytes = $7,
                        checksum_sha256 = $8,
                        uploaded_by = $9,
                        uploaded_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $10 AND company_id = $11 AND UPPER(market_code) = $12
                    RETURNING id, document_code, document_name, status, storage_provider, storage_key,
                              original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_at
                `;
                result = await client.query(updateQuery, [
                    normalizedDocumentStatus,
                    fileData.storage_provider || 'local',
                    fileData.storage_bucket || null,
                    storageKey,
                    safeFilename,
                    fileData.mime_type || 'application/octet-stream',
                    fileData.file_size_bytes || 0,
                    fileData.checksum_sha256 || null,
                    userId,
                    documentId,
                    companyId,
                    normalizedMarketCode
                ]);
            } else {
                // Create new document record
                const insertQuery = `
                    INSERT INTO compliance_documents (
                        id, company_id, market_code, document_code, document_name,
                        status, storage_provider, storage_bucket, storage_key,
                        original_filename, mime_type, file_size_bytes, checksum_sha256,
                        uploaded_by, uploaded_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                    RETURNING id, document_code, document_name, status, storage_provider, storage_key,
                              original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_at
                `;
                result = await client.query(insertQuery, [
                    documentId,
                    companyId,
                    normalizedMarketCode,
                    fileData.document_code || null,
                    fileData.document_name || 'Untitled Document',
                    normalizedDocumentStatus,
                    fileData.storage_provider || 'local',
                    fileData.storage_bucket || null,
                    storageKey,
                    safeFilename,
                    fileData.mime_type || 'application/octet-stream',
                    fileData.file_size_bytes || 0,
                    fileData.checksum_sha256 || null,
                    userId
                ]);
            }

            const productIds = Array.isArray(options.product_ids)
                ? options.product_ids
                : [];
            if (productIds.length > 0) {
                await domesticComplianceService.linkDocumentToProducts(client, {
                    companyId,
                    normalizedMarketCode,
                    complianceDocumentId: result.rows[0].id,
                    productIds,
                    userId,
                    source: options.source || 'manual'
                });
            }

            await this._recalculateMarketScore(client, market.id, companyId, normalizedMarketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true, data: result.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Import compliance document mappings for products.
     * Row format (flexible keys):
     * - product_id | productId | product_code | productCode | sku
     * - document_id | documentId | document_code | documentCode
     * - document_name | documentName
     * - storage_key | file_path | document_path | path | document_url
     * - status (missing|uploaded|approved|expired)
     */
    async importDocumentMappings(companyId, marketCode, userId, rows = []) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }
            const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();

            const normalizedRows = Array.isArray(rows) ? rows : [];
            let imported = 0;
            let failed = 0;
            const errors = [];

            for (let index = 0; index < normalizedRows.length; index += 1) {
                const rowNumber = index + 1;
                const row = normalizedRows[index];

                try {
                    if (!row || typeof row !== 'object' || Array.isArray(row)) {
                        throw {
                            code: 'INVALID_IMPORT_ROW',
                            message: 'Row must be an object.'
                        };
                    }

                    const productId = await this._resolveProductIdFromImportRow(client, companyId, row);
                    if (!productId) {
                        throw {
                            code: 'PRODUCT_NOT_FOUND',
                            message: 'Unable to resolve product from row.'
                        };
                    }

                    const document = await this._resolveOrCreateImportDocument(
                        client,
                        companyId,
                        normalizedMarketCode,
                        userId,
                        row
                    );

                    if (!document?.id) {
                        throw {
                            code: 'DOCUMENT_NOT_FOUND',
                            message: 'Unable to resolve compliance document from row.'
                        };
                    }

                    await domesticComplianceService.linkDocumentToProducts(client, {
                        companyId,
                        normalizedMarketCode,
                        complianceDocumentId: document.id,
                        productIds: [productId],
                        userId,
                        source: 'import'
                    });

                    imported += 1;
                } catch (rowError) {
                    failed += 1;
                    errors.push({
                        row: rowNumber,
                        code: String(rowError?.code || 'IMPORT_ERROR'),
                        message: String(rowError?.message || 'Failed to import row.')
                    });
                }
            }

            await this._recalculateMarketScore(client, market.id, companyId, normalizedMarketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return {
                success: true,
                data: {
                    imported,
                    failed,
                    errors
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
     * Download document from a market
     */
    async getDocumentDownload(companyId, marketCode, documentId) {
        const client = await pool.connect();
        try {
            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            const query = `
                SELECT id, document_name, storage_provider, storage_bucket, storage_key,
                       original_filename, mime_type, file_size_bytes
                FROM compliance_documents
                WHERE id = $1 AND company_id = $2 AND market_code = $3
            `;
            const result = await client.query(query, [documentId, companyId, marketCode]);

            if (result.rows.length === 0) {
                return { success: false, error: 'DOCUMENT_NOT_FOUND' };
            }

            const doc = result.rows[0];
            if (!doc.storage_key) {
                return { success: false, error: 'DOCUMENT_FILE_NOT_FOUND' };
            }

            return {
                success: true,
                data: {
                    document_name: doc.document_name,
                    original_filename: doc.original_filename,
                    storage_provider: doc.storage_provider,
                    storage_bucket: doc.storage_bucket,
                    storage_key: doc.storage_key,
                    mime_type: doc.mime_type,
                    file_size_bytes: doc.file_size_bytes
                }
            };
        } finally {
            client.release();
        }
    }

    /**
     * Approve uploaded document for a market
     */
    async approveDocument(companyId, marketCode, documentId, userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }
            const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();

            const documentResult = await client.query(
                `
                SELECT id, status, storage_key
                FROM compliance_documents
                WHERE id = $1
                  AND company_id = $2
                  AND UPPER(market_code) = $3
                LIMIT 1
                `,
                [documentId, companyId, normalizedMarketCode]
            );

            if (documentResult.rows.length === 0) {
                return { success: false, error: 'DOCUMENT_NOT_FOUND' };
            }

            const documentRow = documentResult.rows[0];
            const currentStatus = this._toDocumentStatus(documentRow.status);
            const hasStorageFile = Boolean(String(documentRow.storage_key || '').trim());

            if (!hasStorageFile || currentStatus === 'missing') {
                return {
                    success: false,
                    error: 'DOCUMENT_NOT_UPLOADED',
                    message: 'Document must be uploaded before approval.'
                };
            }

            const updateResult = await client.query(
                `
                UPDATE compliance_documents
                SET status = 'approved',
                    uploaded_by = COALESCE($4, uploaded_by),
                    uploaded_at = COALESCE(uploaded_at, NOW()),
                    updated_at = NOW()
                WHERE id = $1
                  AND company_id = $2
                  AND UPPER(market_code) = $3
                RETURNING id, document_code, document_name, status, storage_provider, storage_key,
                          original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_at
                `,
                [documentId, companyId, normalizedMarketCode, userId || null]
            );

            await this._recalculateMarketScore(client, market.id, companyId, normalizedMarketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true, data: updateResult.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Remove document from a market
     */
    async removeDocument(companyId, marketCode, documentId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            // Per requirements: mark as missing and clear storage fields (or hard delete per policy)
            const updateQuery = `
                UPDATE compliance_documents
                SET status = 'missing',
                    storage_provider = NULL,
                    storage_bucket = NULL,
                    storage_key = NULL,
                    original_filename = NULL,
                    mime_type = NULL,
                    file_size_bytes = 0,
                    checksum_sha256 = NULL,
                    uploaded_by = NULL,
                    uploaded_at = NULL,
                    updated_at = NOW()
                WHERE id = $1 AND company_id = $2 AND market_code = $3
                RETURNING id
            `;
            const updateResult = await client.query(updateQuery, [documentId, companyId, marketCode]);

            if (updateResult.rows.length === 0) {
                // If no row found in compliance_documents, it may not exist
                return { success: false, error: 'DOCUMENT_NOT_FOUND' };
            }

            // TODO: Actually remove file from storage provider here

            await this._recalculateMarketScore(client, market.id, companyId, marketCode);
            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Generate compliance report for a market
     */
    async generateComplianceReport(companyId, userId, marketCode, fileFormat) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const market = await this._getMarketByCode(client, companyId, marketCode);
            if (!market) {
                return { success: false, error: 'MARKET_NOT_FOUND' };
            }

            await this._recalculateMarketScore(client, market.id, companyId, marketCode);
            const marketAfterRecalculate = await this._getMarketByCode(client, companyId, marketCode);
            const effectiveMarket = marketAfterRecalculate || market;

            // Validate market status (must be ready or verified)
            if (!['ready', 'verified'].includes(effectiveMarket.status)) {
                return {
                    success: false,
                    error: 'MARKET_NOT_READY',
                    message: `Market status must be 'ready' or 'verified'. Current: ${effectiveMarket.status}`
                };
            }

            // Create a report record with storage fields
            const insertQuery = `
                INSERT INTO reports (
                    company_id, report_type, title, target_market,
                    file_format, status, created_by, metadata
                ) VALUES ($1, 'compliance', $2, $3, $4, 'processing', $5, $6)
                RETURNING id, status, created_at
            `;

            const title = `Compliance Report - ${effectiveMarket.market_name} - ${new Date().toISOString().split('T')[0]}`;
            const metadata = {
                market_code: marketCode,
                market_name: effectiveMarket.market_name,
                market_score: effectiveMarket.score,
                generated_for: 'export_compliance'
            };

            const insertResult = await client.query(insertQuery, [
                companyId,
                title,
                marketCode,
                fileFormat,
                userId,
                JSON.stringify(metadata)
            ]);

            await client.query('COMMIT');
            this.invalidateListCache(companyId);

            const report = insertResult.rows[0];

            reportJobQueue.enqueue({
                type: 'market_compliance_report',
                reportId: report.id,
                companyId
            });

            return {
                success: true,
                data: {
                    report_id: report.id,
                    status: report.status,
                    download_url: null
                }
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // =============================================
    // PRIVATE HELPERS
    // =============================================

    _toDocumentStatus(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (
            normalized === 'missing' ||
            normalized === 'uploaded' ||
            normalized === 'approved' ||
            normalized === 'expired'
        ) {
            return normalized;
        }
        return 'uploaded';
    }

    async _hasProductComplianceDocumentsTable(client) {
        void client;
        return getSchemaCapabilities().hasProductComplianceDocuments;
    }

    async _getEmissionFactors() {
        const cached = this.emissionFactorsCache.get('global');
        if (typeof cached !== 'undefined') {
            return cached;
        }

        const result = await pool.query(
            `
                SELECT id, category, subcategory, factor_value, unit, source, version
                FROM emission_factors
                ORDER BY category, subcategory
                LIMIT 50
            `
        );
        this.emissionFactorsCache.set('global', result.rows);
        return result.rows;
    }

    async _listCompanyMarkets(client, companyId) {
        const targetMarketsResult = await client.query(
            'SELECT target_markets FROM companies WHERE id = $1 LIMIT 1',
            [companyId]
        );

        const companyTargetMarkets = Array.isArray(targetMarketsResult.rows[0]?.target_markets)
            ? targetMarketsResult.rows[0].target_markets
            : [];

        const selectedCodes = normalizeTargetMarkets(
            companyTargetMarkets.length > 0 ? companyTargetMarkets : DEFAULT_MARKET_CODES
        );

        const existingMarketsResult = await client.query(
            `
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
                ORDER BY em.market_name ASC
            `,
            [companyId]
        );

        const existingMarketsByCode = new Map(
            existingMarketsResult.rows.map((row) => [
                String(row.market_code || '').trim().toUpperCase(),
                row
            ])
        );

        const mergedCodes = Array.from(new Set([
            ...selectedCodes,
            ...existingMarketsByCode.keys()
        ]));

        return mergedCodes.map((marketCode) => {
            const existing = existingMarketsByCode.get(marketCode);
            if (existing) {
                return existing;
            }

            return {
                id: null,
                market_code: marketCode,
                market_name: this._resolveMarketName(marketCode),
                status: 'draft',
                score: 0,
                verification_status: null,
                verification_date: null,
                verification_body: null,
                verification_notes: null,
                created_at: null,
                updated_at: null
            };
        }).sort((left, right) => String(left.market_name || '').localeCompare(String(right.market_name || '')));
    }

    _readImportValue(row, keys) {
        for (const key of keys) {
            if (typeof row[key] === 'undefined' || row[key] === null) continue;
            const value = String(row[key]).trim();
            if (value.length > 0) {
                return value;
            }
        }
        return '';
    }

    _normalizeImportStorageKey(value) {
        return String(value || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/\.\./g, '_')
            .replace(/^\/+/, '');
    }

    _normalizeImportDocumentCode(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    async _resolveProductIdFromImportRow(client, companyId, row) {
        const explicitProductId = this._readImportValue(row, ['product_id', 'productId']);
        if (explicitProductId) {
            const byIdResult = await client.query(
                `
                SELECT id
                FROM products
                WHERE id = $1 AND company_id = $2
                LIMIT 1
                `,
                [explicitProductId, companyId]
            );
            if (byIdResult.rows.length > 0) {
                return byIdResult.rows[0].id;
            }
        }

        const productCode = this._readImportValue(row, ['product_code', 'productCode', 'sku']);
        if (!productCode) {
            return null;
        }

        const byCodeResult = await client.query(
            `
            SELECT id
            FROM products
            WHERE company_id = $1
              AND sku = $2
            LIMIT 1
            `,
            [companyId, productCode]
        );

        return byCodeResult.rows[0]?.id || null;
    }

    async _resolveOrCreateImportDocument(client, companyId, marketCode, userId, row) {
        const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
        const explicitDocumentId = this._readImportValue(row, ['document_id', 'documentId']);
        const rawDocumentCode = this._readImportValue(row, ['document_code', 'documentCode']);
        const normalizedDocumentCode = this._normalizeImportDocumentCode(rawDocumentCode);
        const documentName =
            this._readImportValue(row, ['document_name', 'documentName']) ||
            (normalizedDocumentCode || 'Imported Document');
        const rawStoragePath = this._readImportValue(
            row,
            ['storage_key', 'document_path', 'file_path', 'path', 'document_url']
        );
        const normalizedStoragePath = this._normalizeImportStorageKey(rawStoragePath);
        const explicitStatus = this._readImportValue(row, ['status']);
        const normalizedStatus = explicitStatus
            ? this._toDocumentStatus(explicitStatus)
            : (normalizedStoragePath ? 'uploaded' : 'missing');

        let documentRow = null;

        if (explicitDocumentId) {
            const byIdResult = await client.query(
                `
                SELECT id, document_code, document_name, status, storage_provider, storage_bucket, storage_key,
                       original_filename, mime_type, file_size_bytes, checksum_sha256
                FROM compliance_documents
                WHERE id = $1
                  AND company_id = $2
                  AND UPPER(market_code) = $3
                LIMIT 1
                `,
                [explicitDocumentId, companyId, normalizedMarketCode]
            );
            documentRow = byIdResult.rows[0] || null;
        }

        if (!documentRow && normalizedDocumentCode) {
            const byCodeResult = await client.query(
                `
                SELECT id, document_code, document_name, status, storage_provider, storage_bucket, storage_key,
                       original_filename, mime_type, file_size_bytes, checksum_sha256
                FROM compliance_documents
                WHERE company_id = $1
                  AND UPPER(market_code) = $2
                  AND LOWER(COALESCE(document_code, '')) = $3
                LIMIT 1
                `,
                [companyId, normalizedMarketCode, normalizedDocumentCode]
            );
            documentRow = byCodeResult.rows[0] || null;
        }

        const safeFilename = this._readImportValue(row, ['original_filename', 'originalFilename']) ||
            (normalizedStoragePath ? normalizedStoragePath.split('/').pop() : '') ||
            `${normalizedDocumentCode || 'document'}.pdf`;
        const mimeType = this._readImportValue(row, ['mime_type', 'mimeType']) || 'application/octet-stream';
        const fileSizeBytesRaw = this._readImportValue(row, ['file_size_bytes', 'fileSizeBytes']);
        const fileSizeBytes = Number.isFinite(Number(fileSizeBytesRaw))
            ? Math.max(0, Math.trunc(Number(fileSizeBytesRaw)))
            : 0;
        const checksumSha256 = this._readImportValue(row, ['checksum_sha256', 'checksumSha256']) || null;

        if (!documentRow) {
            const generatedCode = normalizedDocumentCode ||
                this._normalizeImportDocumentCode(documentName) ||
                `imported_doc_${Date.now()}`;
            const insertResult = await client.query(
                `
                INSERT INTO compliance_documents (
                    id, company_id, market_code, document_code, document_name,
                    status, storage_provider, storage_bucket, storage_key,
                    original_filename, mime_type, file_size_bytes, checksum_sha256,
                    uploaded_by, uploaded_at, created_at, updated_at
                )
                VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, CASE WHEN $6 IN ('uploaded', 'approved') THEN NOW() ELSE NULL END, NOW(), NOW()
                )
                RETURNING id, document_code, document_name, status, storage_provider, storage_bucket, storage_key
                `,
                [
                    randomUUID(),
                    companyId,
                    normalizedMarketCode,
                    generatedCode,
                    documentName,
                    normalizedStatus,
                    normalizedStoragePath ? 'local' : null,
                    null,
                    normalizedStoragePath || null,
                    safeFilename,
                    mimeType,
                    fileSizeBytes,
                    checksumSha256,
                    userId || null
                ]
            );
            return insertResult.rows[0];
        }

        const mergedDocumentCode = normalizedDocumentCode ||
            this._normalizeImportDocumentCode(documentRow.document_code);
        const mergedDocumentName = documentName || documentRow.document_name || mergedDocumentCode;
        const mergedStatus = normalizedStoragePath ? normalizedStatus : this._toDocumentStatus(documentRow.status);
        const mergedStorageProvider = normalizedStoragePath
            ? 'local'
            : (documentRow.storage_provider || null);
        const mergedStorageKey = normalizedStoragePath || documentRow.storage_key || null;

        const updateResult = await client.query(
            `
            UPDATE compliance_documents
            SET document_code = $1,
                document_name = $2,
                status = $3,
                storage_provider = $4,
                storage_key = $5,
                original_filename = $6,
                mime_type = $7,
                file_size_bytes = $8,
                checksum_sha256 = $9,
                uploaded_by = CASE WHEN $3 IN ('uploaded', 'approved') THEN $10 ELSE uploaded_by END,
                uploaded_at = CASE WHEN $3 IN ('uploaded', 'approved') THEN NOW() ELSE uploaded_at END,
                updated_at = NOW()
            WHERE id = $11
            RETURNING id, document_code, document_name, status, storage_provider, storage_bucket, storage_key
            `,
            [
                mergedDocumentCode || null,
                mergedDocumentName || 'Imported Document',
                mergedStatus,
                mergedStorageProvider,
                mergedStorageKey,
                safeFilename,
                mimeType,
                fileSizeBytes,
                checksumSha256,
                userId || null,
                documentRow.id
            ]
        );

        return updateResult.rows[0] || documentRow;
    }

    async _ensureMarketsAndRequiredDocuments(client, companyId) {
        const markets = await this._ensureExportMarkets(client, companyId);
        if (markets.length === 0) {
            return [];
        }

        await this._ensureRequiredDocuments(client, companyId, markets);
        await this._ensureMaterialCertificationDocuments(client, companyId, markets);
        return markets;
    }

    async _ensureExportMarkets(client, companyId) {
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
                    [companyId, code, this._resolveMarketName(code)]
                );
            }

            marketsResult = await client.query(getMarketsByCodesQuery, [companyId, requestedCodes]);
        }

        return marketsResult.rows;
    }

    async _ensureRequiredDocuments(client, companyId, markets) {
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
            existingDocsResult.rows.map(d => `${d.market_code}::${this._normalizeDocumentCode(d.document_code)}`)
        );

        for (const market of markets) {
            const marketCode = String(market.market_code || '').trim().toUpperCase();
            const requiredDocs = this._getRequiredDocumentsForMarket(marketCode);

            for (const doc of requiredDocs) {
                const normalizedDocCode = this._normalizeDocumentCode(doc.code);
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

    async _ensureMaterialCertificationDocuments(client, companyId, markets) {
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
            existingDocsResult.rows.map(d => `${d.market_code}::${this._normalizeDocumentCode(d.document_code)}`)
        );

        for (const market of markets) {
            const marketCode = String(market.market_code || '').trim().toUpperCase();

            for (const template of MATERIAL_CERTIFICATION_DOCUMENTS) {
                const normalizedDocumentCode = this._normalizeDocumentCode(template.code);
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

    _resolveMarketName(marketCode) {
        const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
        return MARKET_REQUIREMENTS_BY_CODE[normalizedMarketCode]?.market_name || `Market ${normalizedMarketCode}`;
    }

    _getRequiredDocumentsForMarket(marketCode) {
        const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
        const templates = MARKET_REQUIREMENTS_BY_CODE[normalizedMarketCode]?.required_documents;
        const base = Array.isArray(templates) && templates.length > 0 ? templates : DEFAULT_REQUIRED_DOCUMENTS;

        return base.map(doc => ({
            code: this._normalizeDocumentCode(doc.code),
            name: doc.name,
            document_type: doc.document_type || null,
            regulation_reference: doc.regulation_reference || null
        }));
    }

    _normalizeDocumentCode(documentCode) {
        return String(documentCode || '').trim().toLowerCase();
    }

    async _getMarketByCode(client, companyId, marketCode) {
        const normalizedMarketCode = String(marketCode || '').trim().toUpperCase();
        const query = `
            SELECT id, market_code, market_name, status, score
            FROM export_markets
            WHERE company_id = $1 AND UPPER(market_code) = $2
        `;
        const result = await client.query(query, [companyId, normalizedMarketCode]);
        if (result.rows[0]) {
            return result.rows[0];
        }

        if (!SUPPORTED_TARGET_MARKETS_SET.has(normalizedMarketCode)) {
            return null;
        }

        const insertResult = await client.query(
            `
                INSERT INTO export_markets (
                    company_id,
                    market_code,
                    market_name,
                    status,
                    score,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, 'draft', 0, NOW(), NOW())
                ON CONFLICT (company_id, market_code) DO UPDATE
                SET market_name = EXCLUDED.market_name
                RETURNING id, market_code, market_name, status, score
            `,
            [companyId, normalizedMarketCode, this._resolveMarketName(normalizedMarketCode)]
        );

        return insertResult.rows[0] || null;
    }

    async _recalculateMarketScore(client, marketId, companyId, marketCode) {
        // Readiness score must match required document completion for each market.
        let score = 0;
        let status = 'draft';

        if (companyId && marketCode) {
            const requiredDocumentCodes = Array.from(
                new Set(
                    this._getRequiredDocumentsForMarket(marketCode)
                        .map(doc => this._normalizeDocumentCode(doc.code))
                        .filter(Boolean)
                )
            );

            if (requiredDocumentCodes.length > 0) {
                const docsProgressQuery = `
                    WITH required_codes AS (
                        SELECT UNNEST($3::text[]) AS code
                    ),
                    docs_by_code AS (
                        SELECT
                            LOWER(COALESCE(document_code, '')) AS code,
                            BOOL_OR(LOWER(COALESCE(status, 'missing')) IN ('uploaded', 'approved')) AS is_done
                        FROM compliance_documents
                        WHERE company_id = $1
                          AND UPPER(market_code) = UPPER($2)
                        GROUP BY LOWER(COALESCE(document_code, ''))
                    )
                    SELECT
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE COALESCE(docs_by_code.is_done, FALSE))::int AS done
                    FROM required_codes
                    LEFT JOIN docs_by_code
                      ON docs_by_code.code = required_codes.code
                `;
                const docsProgressResult = await client.query(docsProgressQuery, [
                    companyId,
                    marketCode,
                    requiredDocumentCodes
                ]);

                const totalRequired = Number(docsProgressResult.rows[0]?.total || 0);
                const doneRequired = Number(docsProgressResult.rows[0]?.done || 0);

                score = totalRequired > 0 ? (doneRequired / totalRequired) * 100 : 0;
            }

            score = Math.max(0, Math.min(100, Math.round(score * 100) / 100));

            if (score >= 100) status = 'ready';
            else if (score > 0) status = 'incomplete';
            else status = 'draft';
        }

        await client.query(
            'UPDATE export_markets SET score = $1, status = $2, updated_at = NOW() WHERE id = $3',
            [score, status, marketId]
        );
    }

    _groupBy(arr, key) {
        return arr.reduce((acc, item) => {
            const k = item[key];
            if (!acc[k]) acc[k] = [];
            acc[k].push(item);
            return acc;
        }, {});
    }

    async _simulateComplianceReport(reportId, companyId) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const client = await pool.connect();
        try {
            const storageKey = `reports/${companyId}/compliance/${reportId}.pdf`;
            const fileSize = Math.floor(Math.random() * 300000) + 10000;

            await client.query(`
                UPDATE reports
                SET status = 'completed',
                    storage_provider = 'local',
                    storage_key = $1,
                    original_filename = $2,
                    download_url = $3,
                    file_size_bytes = $4,
                    generated_at = NOW(),
                    updated_at = NOW()
                WHERE id = $5 AND company_id = $6
            `, [storageKey, `compliance_report_${reportId}.pdf`, `/api/reports/${reportId}/download`, fileSize, reportId, companyId]);
        } catch (error) {
            await client.query(`
                UPDATE reports
                SET status = 'failed', error_message = $1, updated_at = NOW()
                WHERE id = $2
            `, [error.message, reportId]).catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new ExportMarketsService();
