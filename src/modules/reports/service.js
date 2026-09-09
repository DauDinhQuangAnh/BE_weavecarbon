const pool = require('../shared/database');
const { once } = require('events');
const path = require('path');
const fs = require('fs');
const { UPLOADS_ROOT } = require('../shared/runtime');
const analyticsService = require('../shared/analytics');
const reportJobQueue = require('./jobQueue');
const pdfReportService = require('./pdfService');
const { createAppError } = require('../shared/errors');
const { requireAuthoritativeProductCarbon } = require('../carbon');
const { buildOfficialReportPayload } = require('./officialCarbonPayload');
const {
    buildAuditBundleArchive,
    CONTRIBUTION_SCHEMA,
    safeFilename,
    sha256
} = require('./auditBundle');
const {
    createAuditIssuanceSignature,
    createAuditShareToken,
    deriveExternalAssuranceStatus,
    normalizeAuditShareToken,
    verifyAuditIssuanceSignature
} = require('./auditTrust');

const PDF_REPORT_TYPES = new Set(['product_carbon', 'batch_export', 'facility_emission', 'compliance']);
const QA_EXCEPTION_SEVERITIES = new Set(['warning', 'blocking']);
const QA_EXCEPTION_STATUSES = new Set(['open', 'resolved']);
const AUDIT_ASSURANCE_OUTCOMES = new Set([
    'requested', 'evidence_received', 'limited_assurance', 'reasonable_assurance',
    'qualified', 'adverse', 'withdrawn'
]);
const isValidIsoDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const {
    normalizeUuid,
    pushTransactionalAnalyticsEvent,
    safeTrackAnalyticsEvent
} = require('./helpers');

const normalizeQaExceptions = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100) {
        throw createAppError('qaExceptions must be an array with at most 100 entries.', {
            statusCode: 400, code: 'AUDIT_QA_EXCEPTIONS_INVALID'
        });
    }
    return value.map((item, index) => {
        const code = String(item?.code || '').trim().slice(0, 100);
        const message = String(item?.message || '').trim().slice(0, 1000);
        const severity = String(item?.severity || 'blocking').trim().toLowerCase();
        const status = String(item?.status || 'open').trim().toLowerCase();
        if (!code || !message || !QA_EXCEPTION_SEVERITIES.has(severity) || !QA_EXCEPTION_STATUSES.has(status)) {
            throw createAppError(`Invalid QA exception at index ${index}.`, {
                statusCode: 400, code: 'AUDIT_QA_EXCEPTIONS_INVALID'
            });
        }
        return { code, message, severity, status };
    });
};

const deriveAuditLifecycleStatus = (row) => {
    // A newer draft must not invalidate an already issued pack. Supersession is
    // an external lifecycle event and therefore starts only when the replacement
    // version has itself been issued.
    if (row.has_newer_issued_bundle) return 'superseded';
    if (row.issuance_id) return 'issued';
    if (row.status === 'processing') return 'draft';
    if (row.status !== 'completed') return 'blocked';
    const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
    const coverageComplete = manifest?.termEvidenceCoverage?.status === 'complete';
    const exceptions = Array.isArray(row.review_qa_exceptions) ? row.review_qa_exceptions : [];
    const hasBlockingException = exceptions.some((item) => item?.severity === 'blocking' && item?.status !== 'resolved');
    return coverageComplete && row.review_decision === 'approved' && !hasBlockingException ? 'ready' : 'blocked';
};

const extractEvidenceFactorVersionIds = (value) => {
    const extracted = typeof value === 'string' ? (() => {
        try { return JSON.parse(value); } catch { return {}; }
    })() : (value || {});
    const candidates = [
        ...(Array.isArray(extracted.auditClaims?.factorVersionIds)
            ? extracted.auditClaims.factorVersionIds : []),
        ...(Array.isArray(extracted.factorVersionIds) ? extracted.factorVersionIds : []),
        ...(Array.isArray(extracted.factor_version_ids) ? extracted.factor_version_ids : []),
        extracted.factorVersionId,
        extracted.factor_version_id
    ];
    return [...new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean))].sort();
};

const extractEvidenceCalculationTermNumbers = (value) => {
    const extracted = typeof value === 'string' ? (() => {
        try { return JSON.parse(value); } catch { return {}; }
    })() : (value || {});
    const candidates = [
        ...(Array.isArray(extracted.auditClaims?.calculationTermNumbers)
            ? extracted.auditClaims.calculationTermNumbers : []),
        ...(Array.isArray(extracted.calculationTermNumbers) ? extracted.calculationTermNumbers : []),
        ...(Array.isArray(extracted.calculation_term_numbers) ? extracted.calculation_term_numbers : [])
    ];
    return [...new Set(candidates
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0))].sort((a, b) => a - b);
};

class ReportsService {
    constructor({
        database = pool,
        analytics = analyticsService,
        jobQueue = reportJobQueue,
        pdfService = pdfReportService,
        uploadsRoot = UPLOADS_ROOT,
        loadProductCarbon = requireAuthoritativeProductCarbon
    } = {}) {
        this.database = database;
        this.analytics = analytics;
        this.jobQueue = jobQueue;
        this.pdfService = pdfService;
        this.uploadsRoot = uploadsRoot;
        this.loadProductCarbon = loadProductCarbon;
    }

    async getActiveV2Template() {
        const result = await this.database.query(
            `
                SELECT id, template_key, version, title, config
                FROM report_templates
                WHERE template_key = 'WEAVE_CARBON_TEMPLATE_v2.0'
                ORDER BY updated_at DESC
                LIMIT 1
            `
        );
        return result.rows[0] || null;
    }

    async createV2Snapshot(companyId, userId, snapshotData = {}) {
        const template = await this.getActiveV2Template();
        const requestedProductId = normalizeUuid(snapshotData.product_id || snapshotData.productId);
        if (!requestedProductId) {
            throw createAppError('productId is required for an official report snapshot.', {
                statusCode: 400,
                code: 'PRODUCT_ID_REQUIRED'
            });
        }
        const authorityRecord = await this.loadProductCarbon(
            this.database,
            requestedProductId,
            companyId
        );
        const payload = buildOfficialReportPayload(snapshotData.payload || {}, authorityRecord);
        const productId = authorityRecord.product.id;
        const sku = authorityRecord.product.sku;
        const chartData = {
            pieData: payload.pieData,
            esgRows: payload.esgRows,
            cbamRows: payload.cbamRows
        };
        const formulas = Object.fromEntries(
            payload.breakdownRows.map((row, index) => [`row_${index + 1}`, row.formula])
        );

        const result = await this.database.query(
            `
                INSERT INTO report_snapshots (
                    company_id,
                    product_id,
                    report_template_id,
                    sku,
                    snapshot_type,
                    payload,
                    style_config,
                    chart_data,
                    formulas,
                    created_by
                ) VALUES ($1,$2,$3,$4,'weave_carbon_v2',$5,$6,$7,$8,$9)
                RETURNING id, sku, snapshot_type, created_at
            `,
            [
                companyId,
                productId,
                template?.id || null,
                sku,
                JSON.stringify(payload),
                JSON.stringify(snapshotData.style_config || snapshotData.styleConfig || {}),
                JSON.stringify(chartData),
                JSON.stringify(formulas),
                userId
            ]
        );
        return {
            ...result.rows[0],
            payload,
            carbonAuthority: authorityRecord.carbonAuthority
        };
    }

    /**
     * List reports for a company with filters and pagination
     */
    async listReports(companyId, filters = {}) {
        const {
            search,
            type,
            status,
            date_from,
            date_to,
            page = 1,
            page_size = 20,
            sort_by = 'created_at',
            sort_order = 'desc'
        } = filters;

        const client = await this.database.connect();
        try {
            // Build WHERE conditions
            const conditions = ['r.company_id = $1'];
            const params = [companyId];
            let paramIndex = 2;

            if (search) {
                conditions.push(`(r.title ILIKE $${paramIndex} OR r.description ILIKE $${paramIndex})`);
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (type) {
                conditions.push(`r.report_type = $${paramIndex}`);
                params.push(type);
                paramIndex++;
            }

            if (status) {
                conditions.push(`r.status = $${paramIndex}`);
                params.push(status);
                paramIndex++;
            }

            if (date_from) {
                conditions.push(`r.created_at >= $${paramIndex}`);
                params.push(date_from);
                paramIndex++;
            }

            if (date_to) {
                conditions.push(`r.created_at <= $${paramIndex}`);
                params.push(date_to);
                paramIndex++;
            }

            const whereClause = conditions.join(' AND ');

            // Count total records
            const countQuery = `
                SELECT COUNT(*) as total
                FROM reports r
                WHERE ${whereClause}
            `;
            const countResult = await client.query(countQuery, [...params]);
            const total = parseInt(countResult.rows[0].total);

            // Calculate pagination
            const offset = (page - 1) * page_size;
            const totalPages = Math.ceil(total / page_size);

            // Validate sort field
            const allowedSortFields = {
                'created_at': 'r.created_at',
                'updated_at': 'r.updated_at',
                'title': 'r.title',
                'status': 'r.status',
                'generated_at': 'r.generated_at'
            };
            const sortField = allowedSortFields[sort_by] || 'r.created_at';
            const orderDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

            // Fetch reports
            const reportsQuery = `
                SELECT
                    r.id,
                    r.report_type,
                    r.title,
                    r.description,
                    r.status,
                    r.file_format,
                    r.records,
                    r.file_size_bytes,
                    r.dataset_type,
                    r.storage_provider,
                    r.storage_bucket,
                    r.storage_key,
                    r.original_filename,
                    r.download_url,
                    r.error_message,
                    r.target_market,
                    r.period_start,
                    r.period_end,
                    r.generated_at,
                    r.metadata,
                    r.created_at,
                    r.updated_at
                FROM reports r
                WHERE ${whereClause}
                ORDER BY ${sortField} ${orderDirection}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            params.push(page_size, offset);

            const reportsResult = await client.query(reportsQuery, params);

            // Format items
            const items = reportsResult.rows.map(row => this._formatReportItem(row));

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
     * Get a single report by ID
     */
    async getReportById(reportId, companyId) {
        const client = await this.database.connect();
        try {
            const query = `
                SELECT
                    r.id,
                    r.report_type,
                    r.title,
                    r.description,
                    r.status,
                    r.file_format,
                    r.records,
                    r.file_size_bytes,
                    r.dataset_type,
                    r.storage_provider,
                    r.storage_bucket,
                    r.storage_key,
                    r.original_filename,
                    r.download_url,
                    r.error_message,
                    r.target_market,
                    r.period_start,
                    r.period_end,
                    r.generated_at,
                    r.metadata,
                    r.created_at,
                    r.updated_at,
                    r.created_by
                FROM reports r
                WHERE r.id = $1 AND r.company_id = $2
            `;
            const result = await client.query(query, [reportId, companyId]);

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];
            return {
                ...this._formatReportItem(row),
                created_by: row.created_by
            };
        } finally {
            client.release();
        }
    }

    /**
     * Create a new report (manual creation)
     * Returns with status = 'processing'
     */
    async createReport(companyId, userId, reportData) {
        const {
            report_type,
            title,
            description,
            period_start,
            period_end,
            target_market,
            file_format = 'xlsx',
            filters = {}
        } = reportData;

        const client = await this.database.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            const metadata = {
                filters,
                record_count: 0,
                total_co2e: 0,
                file_size_bytes: 0
            };

            const insertQuery = `
                INSERT INTO reports (
                    company_id,
                    report_type,
                    title,
                    description,
                    period_start,
                    period_end,
                    target_market,
                    file_format,
                    status,
                    created_by,
                    metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', $9, $10)
                RETURNING id, status, created_at
            `;

            const insertResult = await client.query(insertQuery, [
                companyId,
                report_type,
                title,
                description || null,
                period_start || null,
                period_end || null,
                target_market || null,
                file_format,
                userId,
                JSON.stringify(metadata)
            ]);

            await client.query('COMMIT');

            const report = insertResult.rows[0];

            await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                event_name: 'wc_report_requested',
                user_id: userId,
                company_id: companyId,
                entity_type: 'report',
                entity_id: report.id,
                payload: {
                    report_type,
                    format: file_format
                }
            }, 'wc_report_requested');

            await this.jobQueue.enqueue({
                type: 'manual_report',
                reportId: report.id,
                companyId
            });

            this.analytics.queuePendingDispatch(analyticsEventIds);
            return {
                id: report.id,
                status: report.status,
                message: 'Report generation started'
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async createAuditBundle(companyId, userId, productId) {
        const normalizedProductId = normalizeUuid(productId);
        if (!normalizedProductId) {
            throw createAppError('A valid productId is required.', {
                statusCode: 400,
                code: 'PRODUCT_ID_REQUIRED'
            });
        }
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const snapshotResult = await client.query(`
                SELECT p.id AS product_id, p.sku, p.name,
                       ps.id AS snapshot_id, ps.version AS snapshot_version, ps.payload,
                       ps.calculated_at, ps.engine_version, ps.methodology_version,
                       ps.factor_registry_version, ps.gwp_basis, ps.canonical_input_hash, ps.is_legacy
                FROM products p
                INNER JOIN latest_product_assessment_snapshots ps
                  ON ps.product_id = p.id AND ps.company_id = p.company_id
                WHERE p.id = $1 AND p.company_id = $2 AND p.status <> 'archived'
            `, [normalizedProductId, companyId]);
            if (snapshotResult.rows.length === 0) {
                throw createAppError('Product or authoritative calculation snapshot not found.', {
                    statusCode: 404,
                    code: 'AUDIT_CALCULATION_NOT_FOUND'
                });
            }
            const snapshot = snapshotResult.rows[0];
            const payload = typeof snapshot.payload === 'string' ? JSON.parse(snapshot.payload) : snapshot.payload;
            const carbonResults = payload?.carbonResults || payload?.carbon_results;
            if (snapshot.is_legacy || carbonResults?.calculationTermsSchemaVersion !== CONTRIBUTION_SCHEMA ||
                !Array.isArray(carbonResults?.calculationTerms) || carbonResults.calculationTerms.length === 0) {
                throw createAppError('Recalculate the product before creating an Audit Pack.', {
                    statusCode: 409,
                    code: 'AUDIT_CALCULATION_TERMS_REQUIRED'
                });
            }
            const evidenceResult = await client.query(`
                SELECT id, evidence_type, storage_provider, storage_key, original_filename,
                       mime_type, file_size_bytes, checksum_sha256,
                       reporting_period_start, reporting_period_end, extracted_json
                FROM evidence_documents
                WHERE company_id = $1 AND product_id = $2
                  AND status IN ('locked', 'third_party_verified')
                  AND storage_key IS NOT NULL AND file_size_bytes > 0
                  AND checksum_sha256 ~* '^[a-f0-9]{64}$'
                  AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
                ORDER BY created_at, id
            `, [companyId, normalizedProductId]);
            if (evidenceResult.rows.length === 0) {
                throw createAppError('At least one current, locked evidence file with SHA-256 is required.', {
                    statusCode: 409,
                    code: 'AUDIT_EVIDENCE_REQUIRED'
                });
            }
            const reportResult = await client.query(`
                INSERT INTO reports (
                    company_id, report_type, title, description, file_format,
                    status, records, created_by, metadata
                ) VALUES ($1, 'carbon_audit', $2, $3, 'zip', 'processing', $4, $5, $6::jsonb)
                RETURNING id
            `, [
                companyId,
                `Internal Audit Pack - ${snapshot.sku}`,
                'Server-generated immutable calculation and evidence bundle; not independently verified.',
                evidenceResult.rows.length,
                userId,
                JSON.stringify({ product_id: normalizedProductId, assurance_status: 'not_verified' })
            ]);
            const reportId = reportResult.rows[0].id;
            const bundleResult = await client.query(`
                INSERT INTO audit_bundles (
                    company_id, product_id, calculation_snapshot_id, report_id, version,
                    status, assurance_status, supersedes_id, created_by
                )
                SELECT $1, $2, $3, $4,
                       COALESCE(MAX(version), 0) + 1,
                       'processing', 'not_verified',
                       (ARRAY_AGG(id ORDER BY version DESC))[1], $5
                FROM audit_bundles
                WHERE product_id = $2 AND company_id = $1
                RETURNING id, version, status, assurance_status, created_at
            `, [companyId, normalizedProductId, snapshot.snapshot_id, reportId, userId]);
            const bundle = bundleResult.rows[0];
            await client.query(`
                UPDATE reports
                SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
                WHERE id = $2 AND company_id = $3
            `, [JSON.stringify({ audit_bundle_id: bundle.id }), reportId, companyId]);
            for (const evidence of evidenceResult.rows) {
                await client.query(`
                    INSERT INTO audit_bundle_evidence (
                        audit_bundle_id, evidence_document_id, checksum_sha256, storage_provider,
                        storage_key, original_filename, mime_type, file_size_bytes, evidence_type,
                        reporting_period_start, reporting_period_end, factor_version_ids,
                        calculation_term_numbers
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
                `, [
                    bundle.id, evidence.id, evidence.checksum_sha256.toLowerCase(),
                    evidence.storage_provider, evidence.storage_key,
                    evidence.original_filename || `${evidence.id}.bin`, evidence.mime_type,
                    evidence.file_size_bytes, evidence.evidence_type,
                    evidence.reporting_period_start, evidence.reporting_period_end,
                    JSON.stringify(extractEvidenceFactorVersionIds(evidence.extracted_json)),
                    JSON.stringify(extractEvidenceCalculationTermNumbers(evidence.extracted_json))
                ]);
            }
            await client.query('COMMIT');
            await this.jobQueue.enqueue({
                type: 'audit_bundle', reportId, auditBundleId: bundle.id, companyId
            });
            return {
                id: bundle.id,
                reportId,
                version: Number(bundle.version),
                status: bundle.status,
                lifecycleStatus: 'draft',
                assuranceStatus: bundle.assurance_status,
                downloadUrl: null,
                createdAt: bundle.created_at
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async getAuditBundle(companyId, auditBundleId) {
        const result = await this.database.query(`
            SELECT ab.id, ab.report_id, ab.product_id, ab.calculation_snapshot_id, ab.version, ab.status,
                   ab.assurance_status, ab.manifest, ab.manifest_sha256, ab.bundle_sha256, ab.file_size_bytes,
                   ab.original_filename, ab.error_message, ab.completed_at, ab.created_at,
                   review.id AS review_id, review.decision AS review_decision,
                   review.qa_exceptions AS review_qa_exceptions, review.notes AS review_notes,
                   review.reviewed_by, review.reviewer_name_snapshot, review.reviewer_email_snapshot,
                   review.reviewed_at,
                   issuance.id AS issuance_id, issuance.assertion_text, issuance.criteria,
                   issuance.issued_by, issuance.signer_name_snapshot, issuance.signer_email_snapshot,
                   issuance.signature_algorithm, issuance.signature_payload,
                   issuance.signature_payload_sha256, issuance.signature_public_key,
                   issuance.signature_value, issuance.signature_acknowledged_at, issuance.issued_at,
                   assurance.id AS assurance_id, assurance.outcome AS assurance_outcome,
                   assurance.provider_name AS assurance_provider_name,
                   assurance.practitioner_name AS assurance_practitioner_name,
                   assurance.standard AS assurance_standard, assurance.scope AS assurance_scope,
                   assurance.statement_date AS assurance_statement_date,
                   assurance.valid_to AS assurance_valid_to,
                   assurance.evidence_document_id AS assurance_evidence_document_id,
                   assurance.evidence_sha256 AS assurance_evidence_sha256,
                   assurance.notes AS assurance_notes, assurance.recorded_at AS assurance_recorded_at,
                   COALESCE(shares.items, '[]'::jsonb) AS share_links,
                   EXISTS (
                     SELECT 1
                     FROM audit_bundles newer
                     INNER JOIN audit_bundle_issuances newer_issuance
                       ON newer_issuance.company_id = newer.company_id
                      AND newer_issuance.audit_bundle_id = newer.id
                     WHERE newer.company_id = ab.company_id AND newer.product_id = ab.product_id
                       AND newer.version > ab.version
                   ) AS has_newer_issued_bundle
            FROM audit_bundles ab
            LEFT JOIN LATERAL (
              SELECT r.* FROM audit_bundle_reviews r
              WHERE r.company_id = ab.company_id AND r.audit_bundle_id = ab.id
              ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 1
            ) review ON true
            LEFT JOIN audit_bundle_issuances issuance
              ON issuance.company_id = ab.company_id AND issuance.audit_bundle_id = ab.id
            LEFT JOIN LATERAL (
              SELECT ar.* FROM audit_bundle_assurance_records ar
              WHERE ar.company_id = ab.company_id AND ar.audit_bundle_id = ab.id
              ORDER BY ar.recorded_at DESC, ar.id DESC LIMIT 1
            ) assurance ON true
            LEFT JOIN LATERAL (
              SELECT jsonb_agg(jsonb_build_object(
                'id', sl.id,
                'label', sl.label,
                'expiresAt', sl.expires_at,
                'maxDownloads', sl.max_downloads,
                'downloadCount', sl.download_count,
                'lastAccessedAt', sl.last_accessed_at,
                'revokedAt', sl.revoked_at,
                'revocationReason', sl.revocation_reason,
                'createdAt', sl.created_at
              ) ORDER BY sl.created_at DESC, sl.id DESC) AS items
              FROM audit_bundle_share_links sl
              WHERE sl.company_id = ab.company_id AND sl.audit_bundle_id = ab.id
            ) shares ON true
            WHERE ab.id = $1 AND ab.company_id = $2
        `, [auditBundleId, companyId]);
        const row = result.rows[0];
        if (!row) return null;
        const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
        return {
            id: row.id,
            reportId: row.report_id,
            productId: row.product_id,
            calculationSnapshotId: row.calculation_snapshot_id,
            version: Number(row.version),
            status: row.status,
            lifecycleStatus: deriveAuditLifecycleStatus(row),
            assuranceStatus: deriveExternalAssuranceStatus(
                row.assurance_id ? {
                    outcome: row.assurance_outcome,
                    validTo: row.assurance_valid_to
                } : null
            ),
            termEvidenceCoverage: manifest?.termEvidenceCoverage || null,
            manifestSha256: row.manifest_sha256,
            bundleSha256: row.bundle_sha256,
            fileSizeBytes: Number(row.file_size_bytes || 0),
            filename: row.original_filename,
            errorMessage: row.error_message,
            downloadUrl: row.status === 'completed' ? `/api/reports/${row.report_id}/download` : null,
            latestReview: row.review_id ? {
                id: row.review_id,
                decision: row.review_decision,
                qaExceptions: row.review_qa_exceptions || [],
                notes: row.review_notes,
                reviewedBy: row.reviewed_by,
                reviewerName: row.reviewer_name_snapshot || null,
                reviewerEmail: row.reviewer_email_snapshot || null,
                reviewedAt: row.reviewed_at
            } : null,
            issuance: row.issuance_id ? {
                id: row.issuance_id,
                assertion: row.assertion_text,
                criteria: row.criteria,
                issuedBy: row.issued_by,
                signerName: row.signer_name_snapshot || null,
                signerEmail: row.signer_email_snapshot || null,
                signatureAlgorithm: row.signature_algorithm || null,
                signaturePayloadSha256: row.signature_payload_sha256 || null,
                signaturePublicKey: row.signature_public_key || null,
                signatureValue: row.signature_value || null,
                signatureValid: verifyAuditIssuanceSignature(row),
                signatureAcknowledgedAt: row.signature_acknowledged_at || null,
                issuedAt: row.issued_at
            } : null,
            externalAssurance: row.assurance_id ? {
                id: row.assurance_id,
                outcome: row.assurance_outcome,
                providerName: row.assurance_provider_name,
                practitionerName: row.assurance_practitioner_name,
                standard: row.assurance_standard,
                scope: row.assurance_scope,
                statementDate: row.assurance_statement_date,
                validTo: row.assurance_valid_to,
                evidenceDocumentId: row.assurance_evidence_document_id,
                evidenceSha256: row.assurance_evidence_sha256,
                notes: row.assurance_notes,
                recordedAt: row.assurance_recorded_at
            } : null,
            shareLinks: Array.isArray(row.share_links) ? row.share_links : [],
            completedAt: row.completed_at,
            createdAt: row.created_at
        };
    }

    async reviewAuditBundle(companyId, userId, auditBundleId, payload = {}) {
        const decision = String(payload.decision || '').trim().toLowerCase();
        if (!['approved', 'rejected'].includes(decision)) {
            throw createAppError('decision must be approved or rejected.', {
                statusCode: 400, code: 'AUDIT_REVIEW_DECISION_INVALID'
            });
        }
        const qaExceptions = normalizeQaExceptions(payload.qaExceptions ?? payload.qa_exceptions);
        const notes = String(payload.notes || '').trim().slice(0, 5000) || null;
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                [auditBundleId]
            );
            const bundleResult = await client.query(`
                SELECT ab.id, ab.status,
                       EXISTS (
                         SELECT 1 FROM audit_bundle_issuances ai
                         WHERE ai.company_id = ab.company_id AND ai.audit_bundle_id = ab.id
                       ) AS issued,
                       EXISTS (
                         SELECT 1
                         FROM audit_bundles newer
                         INNER JOIN audit_bundle_issuances newer_issuance
                           ON newer_issuance.company_id = newer.company_id
                          AND newer_issuance.audit_bundle_id = newer.id
                         WHERE newer.company_id = ab.company_id AND newer.product_id = ab.product_id
                           AND newer.version > ab.version
                       ) AS has_newer_issued_bundle
                FROM audit_bundles ab
                WHERE ab.id = $1 AND ab.company_id = $2
                FOR SHARE
            `, [auditBundleId, companyId]);
            const bundle = bundleResult.rows[0];
            if (!bundle) {
                throw createAppError('Audit Pack not found.', { statusCode: 404, code: 'AUDIT_BUNDLE_NOT_FOUND' });
            }
            if (bundle.status !== 'completed') {
                throw createAppError('Only a completed Audit Pack can be reviewed.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_NOT_COMPLETED'
                });
            }
            if (bundle.issued) {
                throw createAppError('An issued Audit Pack cannot receive another review.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_ALREADY_ISSUED'
                });
            }
            if (bundle.has_newer_issued_bundle) {
                throw createAppError('A superseded Audit Pack cannot receive another review.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_SUPERSEDED'
                });
            }
            const inserted = await client.query(`
                INSERT INTO audit_bundle_reviews (
                    company_id, audit_bundle_id, decision, qa_exceptions, notes, reviewed_by,
                    reviewer_name_snapshot, reviewer_email_snapshot
                )
                SELECT $1,$2,$3,$4::jsonb,$5,$6,u.full_name,u.email
                FROM users u WHERE u.id = $6
                RETURNING id, decision, qa_exceptions, notes, reviewed_by,
                          reviewer_name_snapshot, reviewer_email_snapshot, reviewed_at
            `, [companyId, auditBundleId, decision, JSON.stringify(qaExceptions), notes, userId]);
            if (!inserted.rows[0]) {
                throw createAppError('Reviewer identity no longer exists.', {
                    statusCode: 409, code: 'AUDIT_REVIEWER_IDENTITY_REQUIRED'
                });
            }
            await client.query('COMMIT');
            const row = inserted.rows[0];
            return {
                id: row.id,
                decision: row.decision,
                qaExceptions: row.qa_exceptions || [],
                notes: row.notes,
                reviewedBy: row.reviewed_by,
                reviewerName: row.reviewer_name_snapshot,
                reviewerEmail: row.reviewer_email_snapshot,
                reviewedAt: row.reviewed_at
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async issueAuditBundle(companyId, userId, auditBundleId, payload = {}) {
        const assertion = String(payload.assertion || payload.assertionText || '').trim().slice(0, 5000);
        const criteria = String(payload.criteria || '').trim().slice(0, 5000);
        if (!assertion || !criteria) {
            throw createAppError('assertion and criteria are required for internal issue.', {
                statusCode: 400, code: 'AUDIT_ISSUE_ASSERTION_REQUIRED'
            });
        }
        if (payload.signatureAcknowledged !== true && payload.signature_acknowledged !== true) {
            throw createAppError('Explicit signature acknowledgement is required.', {
                statusCode: 400, code: 'AUDIT_SIGNATURE_ACKNOWLEDGEMENT_REQUIRED'
            });
        }
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                [auditBundleId]
            );
            const bundleResult = await client.query(`
                SELECT ab.id, ab.status, ab.manifest, ab.manifest_sha256, ab.bundle_sha256,
                       issuance.id AS issuance_id,
                       review.id AS review_id, review.decision AS review_decision,
                       review.qa_exceptions AS review_qa_exceptions, review.reviewed_by,
                       signer.full_name AS signer_name, signer.email AS signer_email,
                       EXISTS (
                         SELECT 1 FROM audit_bundles newer
                         WHERE newer.company_id = ab.company_id AND newer.product_id = ab.product_id
                           AND newer.version > ab.version AND newer.status = 'completed'
                       ) AS has_newer_completed_bundle
                FROM audit_bundles ab
                LEFT JOIN LATERAL (
                  SELECT r.* FROM audit_bundle_reviews r
                  WHERE r.company_id = ab.company_id AND r.audit_bundle_id = ab.id
                  ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 1
                ) review ON true
                LEFT JOIN audit_bundle_issuances issuance
                  ON issuance.company_id = ab.company_id AND issuance.audit_bundle_id = ab.id
                INNER JOIN users signer ON signer.id = $3
                WHERE ab.id = $1 AND ab.company_id = $2
                FOR UPDATE OF ab
            `, [auditBundleId, companyId, userId]);
            const bundle = bundleResult.rows[0];
            if (!bundle) {
                throw createAppError('Audit Pack not found.', { statusCode: 404, code: 'AUDIT_BUNDLE_NOT_FOUND' });
            }
            if (bundle.status !== 'completed') {
                throw createAppError('Only a completed Audit Pack can be issued.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_NOT_COMPLETED'
                });
            }
            if (bundle.issuance_id) {
                throw createAppError('Audit Pack has already been issued.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_ALREADY_ISSUED'
                });
            }
            if (bundle.has_newer_completed_bundle) {
                throw createAppError('A newer completed Audit Pack exists; issue the latest version.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_OUTDATED'
                });
            }
            const manifest = typeof bundle.manifest === 'string' ? JSON.parse(bundle.manifest) : bundle.manifest;
            if (manifest?.termEvidenceCoverage?.status !== 'complete') {
                throw createAppError('Every calculation term needs period-bound activity and factor evidence.', {
                    statusCode: 409,
                    code: 'AUDIT_EVIDENCE_COVERAGE_INCOMPLETE',
                    details: manifest?.termEvidenceCoverage || null
                });
            }
            if (bundle.review_decision !== 'approved') {
                throw createAppError('The latest human review must approve this Audit Pack.', {
                    statusCode: 409, code: 'AUDIT_REVIEW_APPROVAL_REQUIRED'
                });
            }
            if (bundle.reviewed_by === userId) {
                throw createAppError('Reviewer and issuer must be different people.', {
                    statusCode: 409, code: 'AUDIT_SEGREGATION_OF_DUTIES_REQUIRED'
                });
            }
            const exceptions = Array.isArray(bundle.review_qa_exceptions) ? bundle.review_qa_exceptions : [];
            if (exceptions.some((item) => item?.severity === 'blocking' && item?.status !== 'resolved')) {
                throw createAppError('Blocking QA exceptions must be resolved before issue.', {
                    statusCode: 409, code: 'AUDIT_QA_BLOCKING_EXCEPTIONS'
                });
            }
            const signedAt = new Date().toISOString();
            const signature = createAuditIssuanceSignature({
                companyId,
                auditBundleId,
                manifestSha256: bundle.manifest_sha256,
                bundleSha256: bundle.bundle_sha256,
                assertion,
                criteria,
                signerId: userId,
                signerName: bundle.signer_name,
                signerEmail: bundle.signer_email,
                signedAt
            });
            const inserted = await client.query(`
                INSERT INTO audit_bundle_issuances (
                    company_id, audit_bundle_id, assertion_text, criteria,
                    manifest_sha256, bundle_sha256, issued_by, signer_name_snapshot,
                    signer_email_snapshot, signature_algorithm, signature_payload,
                    signature_payload_sha256, signature_public_key, signature_value,
                    signature_acknowledged_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
                RETURNING id, assertion_text, criteria, issued_by, signer_name_snapshot,
                          signer_email_snapshot, signature_algorithm, signature_payload_sha256,
                          signature_public_key, signature_value, signature_acknowledged_at, issued_at
            `, [companyId, auditBundleId, assertion, criteria,
                bundle.manifest_sha256, bundle.bundle_sha256, userId,
                bundle.signer_name, bundle.signer_email, signature.signatureAlgorithm,
                JSON.stringify(signature.signaturePayload), signature.signaturePayloadSha256,
                signature.signaturePublicKey, signature.signatureValue, signature.signedAt]);
            await client.query('COMMIT');
            const row = inserted.rows[0];
            return {
                id: row.id,
                auditBundleId,
                lifecycleStatus: 'issued',
                assuranceStatus: 'not_verified',
                assertion: row.assertion_text,
                criteria: row.criteria,
                issuedBy: row.issued_by,
                signerName: row.signer_name_snapshot,
                signerEmail: row.signer_email_snapshot,
                signatureAlgorithm: row.signature_algorithm,
                signaturePayloadSha256: row.signature_payload_sha256,
                signaturePublicKey: row.signature_public_key,
                signatureValue: row.signature_value,
                signatureValid: true,
                signatureAcknowledgedAt: row.signature_acknowledged_at,
                issuedAt: row.issued_at
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async createAuditBundleShare(companyId, userId, auditBundleId, payload = {}) {
        const expiresInHours = Number(payload.expiresInHours ?? payload.expires_in_hours ?? 168);
        if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
            throw createAppError('expiresInHours must be an integer between 1 and 720.', {
                statusCode: 400, code: 'AUDIT_SHARE_EXPIRY_INVALID'
            });
        }
        const rawMaxDownloads = payload.maxDownloads ?? payload.max_downloads ?? 10;
        const maxDownloads = rawMaxDownloads === null ? null : Number(rawMaxDownloads);
        if (maxDownloads !== null && (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 100)) {
            throw createAppError('maxDownloads must be null or an integer between 1 and 100.', {
                statusCode: 400, code: 'AUDIT_SHARE_DOWNLOAD_LIMIT_INVALID'
            });
        }
        const label = String(payload.label || '').trim().slice(0, 200) || null;
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                [auditBundleId]
            );
            const bundleResult = await client.query(`
                SELECT ab.id, ab.status, ab.manifest_sha256, ab.bundle_sha256,
                       ai.id AS issuance_id, ai.signature_algorithm, ai.signature_payload,
                       ai.signature_payload_sha256, ai.signature_public_key, ai.signature_value,
                       EXISTS (
                         SELECT 1 FROM audit_bundles newer
                         INNER JOIN audit_bundle_issuances newer_issue
                           ON newer_issue.company_id = newer.company_id
                          AND newer_issue.audit_bundle_id = newer.id
                         WHERE newer.company_id = ab.company_id AND newer.product_id = ab.product_id
                           AND newer.version > ab.version
                       ) AS has_newer_issued_bundle
                FROM audit_bundles ab
                LEFT JOIN audit_bundle_issuances ai
                  ON ai.company_id = ab.company_id AND ai.audit_bundle_id = ab.id
                WHERE ab.id = $1 AND ab.company_id = $2
                FOR SHARE OF ab
            `, [auditBundleId, companyId]);
            const bundle = bundleResult.rows[0];
            if (!bundle) {
                throw createAppError('Audit Pack not found.', {
                    statusCode: 404, code: 'AUDIT_BUNDLE_NOT_FOUND'
                });
            }
            if (bundle.status !== 'completed' || !bundle.issuance_id) {
                throw createAppError('Only an issued Audit Pack can be shared.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_ISSUED_REQUIRED'
                });
            }
            if (bundle.has_newer_issued_bundle) {
                throw createAppError('A superseded Audit Pack cannot receive a new share link.', {
                    statusCode: 409, code: 'AUDIT_BUNDLE_SUPERSEDED'
                });
            }
            if (!verifyAuditIssuanceSignature(bundle)) {
                throw createAppError('The Audit Pack issuance has no valid platform signature.', {
                    statusCode: 409, code: 'AUDIT_ISSUANCE_SIGNATURE_REQUIRED'
                });
            }
            const { token, tokenSha256 } = createAuditShareToken();
            const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
            const inserted = await client.query(`
                INSERT INTO audit_bundle_share_links (
                    company_id, audit_bundle_id, issuance_id, token_sha256, label,
                    manifest_sha256, bundle_sha256, expires_at, max_downloads, created_by
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING id, label, expires_at, max_downloads, download_count, created_at
            `, [companyId, auditBundleId, bundle.issuance_id, tokenSha256, label,
                bundle.manifest_sha256, bundle.bundle_sha256, expiresAt, maxDownloads, userId]);
            await client.query('COMMIT');
            const row = inserted.rows[0];
            return {
                id: row.id,
                label: row.label,
                expiresAt: row.expires_at,
                maxDownloads: row.max_downloads === null ? null : Number(row.max_downloads),
                downloadCount: Number(row.download_count || 0),
                createdAt: row.created_at,
                token,
                shareUrl: `/api/reports/v2/public/audit-pack-shares/${token}/download`
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async revokeAuditBundleShare(companyId, userId, auditBundleId, shareId, payload = {}) {
        const reason = String(payload.reason || '').trim().slice(0, 1000) || null;
        const result = await this.database.query(`
            UPDATE audit_bundle_share_links
            SET revoked_at = now(), revoked_by = $1, revocation_reason = $2
            WHERE id = $3 AND audit_bundle_id = $4 AND company_id = $5 AND revoked_at IS NULL
            RETURNING id, revoked_at, revocation_reason
        `, [userId, reason, shareId, auditBundleId, companyId]);
        if (!result.rows[0]) {
            throw createAppError('Active Audit Pack share link not found.', {
                statusCode: 404, code: 'AUDIT_SHARE_NOT_FOUND'
            });
        }
        return {
            id: result.rows[0].id,
            revokedAt: result.rows[0].revoked_at,
            revocationReason: result.rows[0].revocation_reason
        };
    }

    async createAuditBundleAssuranceRecord(companyId, userId, auditBundleId, payload = {}) {
        const outcome = String(payload.outcome || '').trim().toLowerCase();
        if (!AUDIT_ASSURANCE_OUTCOMES.has(outcome)) {
            throw createAppError('Unsupported external assurance outcome.', {
                statusCode: 400, code: 'AUDIT_ASSURANCE_OUTCOME_INVALID'
            });
        }
        const providerName = String(payload.providerName || payload.provider_name || '').trim().slice(0, 300);
        const scope = String(payload.scope || '').trim().slice(0, 5000);
        const practitionerName = String(payload.practitionerName || payload.practitioner_name || '').trim().slice(0, 300) || null;
        const standard = String(payload.standard || '').trim().slice(0, 500) || null;
        const notes = String(payload.notes || '').trim().slice(0, 5000) || null;
        const statementDate = String(payload.statementDate || payload.statement_date || '').trim() || null;
        const validTo = String(payload.validTo || payload.valid_to || '').trim() || null;
        const evidenceDocumentId = payload.evidenceDocumentId || payload.evidence_document_id || null;
        if (!providerName || !scope) {
            throw createAppError('providerName and scope are required.', {
                statusCode: 400, code: 'AUDIT_ASSURANCE_DETAILS_REQUIRED'
            });
        }
        for (const [field, value] of [['statementDate', statementDate], ['validTo', validTo]]) {
            if (value && !isValidIsoDate(value)) {
                throw createAppError(`${field} must be an ISO date.`, {
                    statusCode: 400, code: 'AUDIT_ASSURANCE_DATE_INVALID'
                });
            }
        }
        const today = new Date().toISOString().slice(0, 10);
        if (statementDate && validTo && validTo < statementDate) {
            throw createAppError('validTo cannot be earlier than statementDate.', {
                statusCode: 400, code: 'AUDIT_ASSURANCE_DATE_INVALID'
            });
        }
        const needsEvidence = !['requested', 'withdrawn'].includes(outcome);
        if (needsEvidence && (!statementDate || !normalizeUuid(evidenceDocumentId))) {
            throw createAppError('A statement date and third-party-verified evidence document are required.', {
                statusCode: 400, code: 'AUDIT_ASSURANCE_EVIDENCE_REQUIRED'
            });
        }
        const normalizedEvidenceId = evidenceDocumentId ? normalizeUuid(evidenceDocumentId) : null;
        if (evidenceDocumentId && !normalizedEvidenceId) {
            throw createAppError('evidenceDocumentId must be a UUID.', {
                statusCode: 400, code: 'AUDIT_ASSURANCE_EVIDENCE_INVALID'
            });
        }
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                [auditBundleId]
            );
            const bundleResult = await client.query(`
                SELECT ab.id, ab.status, ab.product_id, ab.manifest_sha256, ab.bundle_sha256,
                       ai.id AS issuance_id, ai.signature_algorithm, ai.signature_payload,
                       ai.signature_payload_sha256, ai.signature_public_key, ai.signature_value,
                       latest.id AS latest_assurance_id,
                       ed.id AS evidence_id, ed.status AS evidence_status,
                       ed.checksum_sha256 AS evidence_sha256, ed.storage_key AS evidence_storage_key,
                       ed.file_size_bytes AS evidence_file_size, ed.valid_to AS evidence_valid_to,
                       abe.evidence_document_id AS pinned_evidence_id,
                       abe.checksum_sha256 AS pinned_evidence_sha256
                FROM audit_bundles ab
                LEFT JOIN audit_bundle_issuances ai
                  ON ai.company_id = ab.company_id AND ai.audit_bundle_id = ab.id
                LEFT JOIN LATERAL (
                  SELECT ar.id FROM audit_bundle_assurance_records ar
                  WHERE ar.company_id = ab.company_id AND ar.audit_bundle_id = ab.id
                  ORDER BY ar.recorded_at DESC, ar.id DESC LIMIT 1
                ) latest ON true
                LEFT JOIN evidence_documents ed
                  ON ed.id = $3 AND ed.company_id = ab.company_id AND ed.product_id = ab.product_id
                LEFT JOIN audit_bundle_evidence abe
                  ON abe.audit_bundle_id = ab.id AND abe.evidence_document_id = ed.id
                WHERE ab.id = $1 AND ab.company_id = $2
                FOR SHARE OF ab
            `, [auditBundleId, companyId, normalizedEvidenceId]);
            const bundle = bundleResult.rows[0];
            if (!bundle) {
                throw createAppError('Audit Pack not found.', {
                    statusCode: 404, code: 'AUDIT_BUNDLE_NOT_FOUND'
                });
            }
            if (bundle.status !== 'completed' || !bundle.issuance_id || !verifyAuditIssuanceSignature(bundle)) {
                throw createAppError('A valid signed issuance is required before external assurance can be recorded.', {
                    statusCode: 409, code: 'AUDIT_SIGNED_ISSUANCE_REQUIRED'
                });
            }
            if (outcome === 'withdrawn' && !bundle.latest_assurance_id) {
                throw createAppError('There is no assurance record to withdraw.', {
                    statusCode: 409, code: 'AUDIT_ASSURANCE_WITHDRAWAL_INVALID'
                });
            }
            if (needsEvidence) {
                const evidenceValidTo = bundle.evidence_valid_to
                    ? String(bundle.evidence_valid_to).slice(0, 10) : null;
                const evidenceIsCurrent = !evidenceValidTo || evidenceValidTo >= today;
                if (!bundle.evidence_id || !bundle.pinned_evidence_id ||
                    bundle.pinned_evidence_sha256 !== bundle.evidence_sha256 ||
                    bundle.evidence_status !== 'third_party_verified' ||
                    !bundle.evidence_storage_key || Number(bundle.evidence_file_size || 0) <= 0 ||
                    !/^[a-f0-9]{64}$/i.test(bundle.evidence_sha256 || '') || !evidenceIsCurrent) {
                    throw createAppError('Assurance evidence must be pinned in this bundle, current, stored and third-party verified.', {
                        statusCode: 409, code: 'AUDIT_ASSURANCE_EVIDENCE_NOT_VERIFIED'
                    });
                }
                if (validTo && evidenceValidTo && validTo > evidenceValidTo) {
                    throw createAppError('Assurance validity cannot outlive its evidence document.', {
                        statusCode: 409, code: 'AUDIT_ASSURANCE_VALIDITY_EXCEEDS_EVIDENCE'
                    });
                }
            }
            const effectiveValidTo = needsEvidence && !validTo && bundle.evidence_valid_to
                ? String(bundle.evidence_valid_to).slice(0, 10) : validTo;
            const inserted = await client.query(`
                INSERT INTO audit_bundle_assurance_records (
                    company_id, audit_bundle_id, issuance_id, outcome, provider_name,
                    practitioner_name, standard, scope, statement_date, valid_to,
                    evidence_document_id, evidence_sha256, manifest_sha256, bundle_sha256,
                    notes, supersedes_id, recorded_by
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                RETURNING id, outcome, provider_name, practitioner_name, standard, scope,
                          statement_date, valid_to, evidence_document_id, evidence_sha256,
                          notes, supersedes_id, recorded_at
            `, [companyId, auditBundleId, bundle.issuance_id, outcome, providerName,
                practitionerName, standard, scope, statementDate, effectiveValidTo,
                needsEvidence ? bundle.evidence_id : null, needsEvidence ? bundle.evidence_sha256 : null,
                bundle.manifest_sha256, bundle.bundle_sha256, notes,
                bundle.latest_assurance_id || null, userId]);
            await client.query('COMMIT');
            const row = inserted.rows[0];
            return {
                id: row.id,
                outcome: row.outcome,
                assuranceStatus: deriveExternalAssuranceStatus(row),
                providerName: row.provider_name,
                practitionerName: row.practitioner_name,
                standard: row.standard,
                scope: row.scope,
                statementDate: row.statement_date,
                validTo: row.valid_to,
                evidenceDocumentId: row.evidence_document_id,
                evidenceSha256: row.evidence_sha256,
                notes: row.notes,
                supersedesId: row.supersedes_id,
                recordedAt: row.recorded_at
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async _findPublicAuditBundleShare(queryable, tokenSha256, lock = false) {
        const result = await queryable.query(`
            SELECT sl.id AS share_id, sl.label, sl.expires_at, sl.max_downloads,
                   sl.download_count, sl.last_accessed_at,
                   sl.manifest_sha256 AS share_manifest_sha256,
                   sl.bundle_sha256 AS share_bundle_sha256,
                   ab.id AS audit_bundle_id, ab.version, ab.report_id, ab.storage_provider,
                   ab.storage_key, ab.original_filename, ab.mime_type, ab.file_size_bytes,
                   ab.manifest_sha256, ab.bundle_sha256,
                   p.sku, p.name AS product_name,
                   ai.assertion_text, ai.criteria, ai.issued_at,
                   ai.signer_name_snapshot, ai.signer_email_snapshot,
                   ai.signature_algorithm, ai.signature_payload, ai.signature_payload_sha256,
                   ai.signature_public_key, ai.signature_value, ai.signature_acknowledged_at,
                   assurance.outcome AS assurance_outcome,
                   assurance.provider_name AS assurance_provider_name,
                   assurance.practitioner_name AS assurance_practitioner_name,
                   assurance.standard AS assurance_standard, assurance.scope AS assurance_scope,
                   assurance.statement_date AS assurance_statement_date,
                   assurance.valid_to AS assurance_valid_to,
                   assurance.evidence_sha256 AS assurance_evidence_sha256
            FROM audit_bundle_share_links sl
            INNER JOIN audit_bundles ab
              ON ab.id = sl.audit_bundle_id AND ab.company_id = sl.company_id
            INNER JOIN audit_bundle_issuances ai
              ON ai.id = sl.issuance_id AND ai.company_id = sl.company_id
            INNER JOIN products p ON p.id = ab.product_id AND p.company_id = ab.company_id
            LEFT JOIN LATERAL (
              SELECT ar.* FROM audit_bundle_assurance_records ar
              WHERE ar.company_id = ab.company_id AND ar.audit_bundle_id = ab.id
              ORDER BY ar.recorded_at DESC, ar.id DESC LIMIT 1
            ) assurance ON true
            WHERE sl.token_sha256 = $1 AND sl.revoked_at IS NULL AND sl.expires_at > now()
              AND (sl.max_downloads IS NULL OR sl.download_count < sl.max_downloads)
              AND ab.status = 'completed'
              AND NOT EXISTS (
                SELECT 1 FROM audit_bundles newer
                INNER JOIN audit_bundle_issuances newer_issue
                  ON newer_issue.company_id = newer.company_id
                 AND newer_issue.audit_bundle_id = newer.id
                WHERE newer.company_id = ab.company_id AND newer.product_id = ab.product_id
                  AND newer.version > ab.version
              )
            ${lock ? 'FOR UPDATE OF sl' : ''}
        `, [tokenSha256]);
        return result.rows[0] || null;
    }

    _mapPublicAuditBundleShare(row, token) {
        if (!row || row.share_bundle_sha256 !== row.bundle_sha256 ||
            row.share_manifest_sha256 !== row.manifest_sha256 ||
            !verifyAuditIssuanceSignature(row)) return null;
        return {
            schemaVersion: 'weavecarbon-audit-share-v1',
            label: row.label,
            expiresAt: row.expires_at,
            maxDownloads: row.max_downloads === null ? null : Number(row.max_downloads),
            downloadCount: Number(row.download_count || 0),
            bundle: {
                id: row.audit_bundle_id,
                version: Number(row.version),
                sku: row.sku,
                productName: row.product_name,
                manifestSha256: row.manifest_sha256,
                bundleSha256: row.bundle_sha256,
                filename: row.original_filename,
                fileSizeBytes: Number(row.file_size_bytes || 0)
            },
            issuance: {
                assertion: row.assertion_text,
                criteria: row.criteria,
                signerName: row.signer_name_snapshot,
                signerEmail: row.signer_email_snapshot,
                issuedAt: row.issued_at,
                signatureAlgorithm: row.signature_algorithm,
                signaturePayloadSha256: row.signature_payload_sha256,
                signaturePublicKey: row.signature_public_key,
                signatureValue: row.signature_value,
                signatureValid: true,
                signatureAcknowledgedAt: row.signature_acknowledged_at
            },
            assuranceStatus: deriveExternalAssuranceStatus({ outcome: row.assurance_outcome }),
            externalAssurance: row.assurance_outcome ? {
                outcome: row.assurance_outcome,
                providerName: row.assurance_provider_name,
                practitionerName: row.assurance_practitioner_name,
                standard: row.assurance_standard,
                scope: row.assurance_scope,
                statementDate: row.assurance_statement_date,
                validTo: row.assurance_valid_to,
                evidenceSha256: row.assurance_evidence_sha256
            } : null,
            downloadUrl: `/api/reports/v2/public/audit-pack-shares/${token}/download`,
            disclaimer: 'This read-only share proves server-recorded integrity only. It is not a customs filing or certification.'
        };
    }

    async getPublicAuditBundleShare(rawToken) {
        const token = normalizeAuditShareToken(rawToken);
        if (!token) return null;
        const row = await this._findPublicAuditBundleShare(this.database, sha256(token));
        return this._mapPublicAuditBundleShare(row, token);
    }

    async downloadPublicAuditBundleShare(rawToken) {
        const token = normalizeAuditShareToken(rawToken);
        if (!token) return null;
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const row = await this._findPublicAuditBundleShare(client, sha256(token), true);
            const metadata = this._mapPublicAuditBundleShare(row, token);
            if (!metadata || row.storage_provider !== 'local') {
                await client.query('ROLLBACK');
                return null;
            }
            const filePath = path.resolve(this.uploadsRoot, row.storage_key || '');
            const relative = path.relative(this.uploadsRoot, filePath);
            if (!row.storage_key || relative.startsWith('..') || path.isAbsolute(relative)) {
                throw createAppError('Shared Audit Pack has an invalid storage path.', {
                    statusCode: 409, code: 'AUDIT_SHARE_STORAGE_INVALID'
                });
            }
            let buffer;
            try {
                buffer = await fs.promises.readFile(filePath);
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    throw createAppError('Shared Audit Pack file is missing from storage.', {
                        statusCode: 409, code: 'AUDIT_SHARE_STORAGE_MISSING'
                    });
                }
                throw error;
            }
            if (buffer.length !== Number(row.file_size_bytes) || sha256(buffer) !== row.bundle_sha256) {
                throw createAppError('Shared Audit Pack failed its immutable checksum.', {
                    statusCode: 409, code: 'AUDIT_SHARE_CHECKSUM_MISMATCH'
                });
            }
            await client.query(`
                UPDATE audit_bundle_share_links
                SET download_count = download_count + 1, last_accessed_at = now()
                WHERE id = $1
            `, [row.share_id]);
            await client.query('COMMIT');
            return {
                metadata,
                buffer,
                filename: safeFilename(row.original_filename, `AuditPack_${row.audit_bundle_id}.zip`),
                mimeType: row.mime_type || 'application/zip'
            };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async verifyAuditBundleFile(reportId, companyId, filePath) {
        const result = await this.database.query(`
            SELECT bundle_sha256, file_size_bytes
            FROM audit_bundles
            WHERE report_id = $1 AND company_id = $2 AND status = 'completed'
        `, [reportId, companyId]);
        const row = result.rows[0];
        if (!row || !/^[a-f0-9]{64}$/i.test(row.bundle_sha256 || '')) return false;
        const buffer = await fs.promises.readFile(filePath);
        return buffer.length === Number(row.file_size_bytes) &&
            sha256(buffer) === row.bundle_sha256.toLowerCase();
    }

    async _generateAuditBundle(reportId, auditBundleId, companyId) {
        const client = await this.database.connect();
        let temporaryPath;
        try {
            const bundleResult = await client.query(`
                SELECT ab.*, p.sku, p.name,
                       ps.version AS snapshot_version, ps.payload AS snapshot_payload,
                       ps.calculated_at, ps.engine_version, ps.methodology_version,
                       ps.factor_registry_version, ps.gwp_basis, ps.canonical_input_hash
                FROM audit_bundles ab
                INNER JOIN products p ON p.id = ab.product_id AND p.company_id = ab.company_id
                INNER JOIN product_assessment_snapshots ps
                  ON ps.id = ab.calculation_snapshot_id AND ps.company_id = ab.company_id
                WHERE ab.id = $1 AND ab.report_id = $2 AND ab.company_id = $3
            `, [auditBundleId, reportId, companyId]);
            if (bundleResult.rows.length === 0) throw new Error('Audit bundle not found');
            const row = bundleResult.rows[0];
            if (row.status === 'completed') {
                const completedPath = path.resolve(this.uploadsRoot, row.storage_key || '');
                const completedRelative = path.relative(this.uploadsRoot, completedPath);
                if (!row.storage_key || completedRelative.startsWith('..') || path.isAbsolute(completedRelative)) {
                    throw new Error('Completed Audit Pack has an invalid storage path');
                }
                const completedFile = await fs.promises.readFile(completedPath);
                if (completedFile.length !== Number(row.file_size_bytes) ||
                    sha256(completedFile) !== String(row.bundle_sha256 || '').toLowerCase()) {
                    throw new Error('Completed Audit Pack failed its immutable checksum');
                }
                return { auditBundleId, reportId, bundleSha256: row.bundle_sha256 };
            }
            const evidenceResult = await client.query(`
                SELECT * FROM audit_bundle_evidence
                WHERE audit_bundle_id = $1 ORDER BY evidence_document_id
            `, [auditBundleId]);
            const evidenceFiles = [];
            for (const evidence of evidenceResult.rows) {
                if (evidence.storage_provider !== 'local') {
                    throw new Error(`Unsupported evidence storage provider: ${evidence.storage_provider}`);
                }
                const evidencePath = path.resolve(this.uploadsRoot, evidence.storage_key);
                const relative = path.relative(this.uploadsRoot, evidencePath);
                if (relative.startsWith('..') || path.isAbsolute(relative)) {
                    throw new Error('Invalid evidence storage path');
                }
                evidenceFiles.push({ ...evidence, buffer: await fs.promises.readFile(evidencePath) });
            }
            const payload = typeof row.snapshot_payload === 'string'
                ? JSON.parse(row.snapshot_payload) : row.snapshot_payload;
            const archive = await buildAuditBundleArchive({
                bundle: row,
                product: { id: row.product_id, sku: row.sku, name: row.name },
                snapshot: {
                    id: row.calculation_snapshot_id,
                    version: row.snapshot_version,
                    payload,
                    calculated_at: row.calculated_at,
                    engine_version: row.engine_version,
                    methodology_version: row.methodology_version,
                    factor_registry_version: row.factor_registry_version,
                    gwp_basis: row.gwp_basis,
                    canonical_input_hash: row.canonical_input_hash
                },
                evidenceFiles,
                createdAt: row.created_at
            });
            const storageKey = `reports/${companyId}/${new Date().getFullYear()}/${auditBundleId}.zip`;
            const filePath = path.resolve(this.uploadsRoot, storageKey);
            const relative = path.relative(this.uploadsRoot, filePath);
            if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid bundle storage path');
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            temporaryPath = `${filePath}.tmp-${process.pid}`;
            await fs.promises.writeFile(temporaryPath, archive.buffer);
            const stored = await fs.promises.readFile(temporaryPath);
            if (stored.length !== archive.buffer.length || sha256(stored) !== archive.bundleSha256) {
                throw new Error('Stored Audit Pack verification failed');
            }
            await fs.promises.rename(temporaryPath, filePath);
            temporaryPath = null;
            const filename = safeFilename(`AuditPack_${row.sku}_v${row.version}.zip`, `AuditPack_${row.id}.zip`);
            await client.query('BEGIN');
            await client.query(`
                UPDATE audit_bundles
                SET status = 'completed', manifest = $1::jsonb, manifest_sha256 = $2,
                    bundle_sha256 = $3, storage_provider = 'local', storage_key = $4,
                    original_filename = $5, mime_type = 'application/zip', file_size_bytes = $6,
                    error_message = NULL, completed_at = now(), updated_at = now()
                WHERE id = $7 AND company_id = $8 AND status IN ('processing', 'failed')
            `, [JSON.stringify(archive.manifest), archive.manifestSha256, archive.bundleSha256,
                storageKey, filename, archive.buffer.length, auditBundleId, companyId]);
            await client.query(`
                UPDATE reports
                SET status = 'completed', storage_provider = 'local', storage_key = $1,
                    original_filename = $2, download_url = $3, file_size_bytes = $4,
                    file_format = 'zip', generated_at = now(), updated_at = now(),
                    metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
                WHERE id = $6 AND company_id = $7
            `, [storageKey, filename, `/api/reports/${reportId}/download`, archive.buffer.length,
                JSON.stringify({ manifest_sha256: archive.manifestSha256, bundle_sha256: archive.bundleSha256 }),
                reportId, companyId]);
            await client.query('COMMIT');
            return { auditBundleId, reportId, bundleSha256: archive.bundleSha256 };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            if (temporaryPath) await fs.promises.unlink(temporaryPath).catch(() => {});
            await client.query(`
                UPDATE audit_bundles SET status = 'failed', error_message = $1, updated_at = now()
                WHERE id = $2 AND company_id = $3 AND status <> 'completed'
            `, [String(error.message || error), auditBundleId, companyId]).catch(() => {});
            await client.query(`
                UPDATE reports SET status = 'failed', error_message = $1, updated_at = now()
                WHERE id = $2 AND company_id = $3 AND status <> 'completed'
            `, [String(error.message || error), reportId, companyId]).catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update report status (processing | completed | failed)
     */
    async updateReportStatus(reportId, companyId, userId, newStatus) {
        const client = await this.database.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            const selectQuery = `
                SELECT id, status, report_type, dataset_type, file_format FROM reports
                WHERE id = $1 AND company_id = $2
            `;
            const selectResult = await client.query(selectQuery, [reportId, companyId]);

            if (selectResult.rows.length === 0) {
                return { success: false, error: 'REPORT_NOT_FOUND' };
            }

            const currentStatus = selectResult.rows[0].status;

            // Validate status transition
            const validTransitions = {
                'processing': ['completed', 'failed'],
                'failed': ['processing'],       // allow retry
                'completed': []                 // terminal state
            };

            if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(newStatus)) {
                return {
                    success: false,
                    error: 'INVALID_STATUS_TRANSITION',
                    message: `Cannot transition from ${currentStatus} to ${newStatus}`
                };
            }

            let updateQuery;
            let updateParams;

            if (newStatus === 'completed') {
                updateQuery = `
                    UPDATE reports
                    SET status = $1, generated_at = NOW(), updated_at = NOW()
                    WHERE id = $2
                    RETURNING id, status, generated_at, updated_at
                `;
                updateParams = [newStatus, reportId];
            } else {
                updateQuery = `
                    UPDATE reports
                    SET status = $1, updated_at = NOW()
                    WHERE id = $2
                    RETURNING id, status, updated_at
                `;
                updateParams = [newStatus, reportId];
            }

            const updateResult = await client.query(updateQuery, updateParams);

            const reportRow = updateResult.rows[0];
            if (newStatus === 'completed') {
                await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_report_generated',
                    user_id: userId,
                    company_id: companyId,
                    entity_type: 'report',
                    entity_id: reportId,
                    payload: {
                        report_type: selectResult.rows[0].report_type,
                        dataset_type: selectResult.rows[0].dataset_type || undefined,
                        format: selectResult.rows[0].file_format || 'csv'
                    }
                }, 'wc_report_generated');
            }

            if (newStatus === 'failed') {
                await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_report_generation_failed',
                    user_id: userId,
                    company_id: companyId,
                    entity_type: 'report',
                    entity_id: reportId,
                    payload: {
                        report_type: selectResult.rows[0].report_type,
                        dataset_type: selectResult.rows[0].dataset_type || undefined,
                        format: selectResult.rows[0].file_format || 'csv',
                        error_code: 'status_marked_failed'
                    }
                }, 'wc_report_generation_failed');
            }

            await client.query('COMMIT');
            this.analytics.queuePendingDispatch(analyticsEventIds);

            return {
                success: true,
                data: reportRow
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Check if report file is ready for download
     */
    async checkReportFileStatus(reportId, companyId) {
        const client = await this.database.connect();
        try {
            const query = `
                SELECT id, status, storage_key, file_format, storage_provider, storage_bucket, original_filename FROM reports
                WHERE id = $1 AND company_id = $2
            `;
            const result = await client.query(query, [reportId, companyId]);

            if (result.rows.length === 0) {
                return { exists: false };
            }

            const report = result.rows[0];
            const isReady = report.status === 'completed' && report.storage_key;

            return {
                exists: true,
                isReady,
                status: report.status,
                storage_provider: report.storage_provider,
                storage_bucket: report.storage_bucket,
                storage_key: report.storage_key,
                original_filename: report.original_filename,
                file_format: report.file_format
            };
        } finally {
            client.release();
        }
    }

    /**
     * Unified Export Pipeline
     * Creates a report record from a dataset export request
     */
    async createDatasetExport(companyId, userId, exportData) {
        const { dataset_type, file_format = 'csv', title } = exportData;

        const client = await this.database.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            // Get count of records for this dataset
            const recordCount = await this._getDatasetCount(client, companyId, dataset_type);

            const autoTitle = title || `${dataset_type} export - ${new Date().toISOString().split('T')[0]}`;

            const insertQuery = `
                INSERT INTO reports (
                    company_id,
                    report_type,
                    title,
                    dataset_type,
                    file_format,
                    status,
                    records,
                    created_by,
                    metadata
                ) VALUES ($1, 'dataset_export', $2, $3, $4, 'processing', $5, $6, $7)
                RETURNING id, status, records, created_at
            `;

            const metadata = {
                dataset_type,
                export_started_at: new Date().toISOString()
            };

            const insertResult = await client.query(insertQuery, [
                companyId,
                autoTitle,
                dataset_type,
                file_format,
                recordCount,
                userId,
                JSON.stringify(metadata)
            ]);

            await client.query('COMMIT');

            const report = insertResult.rows[0];

            await pushTransactionalAnalyticsEvent(client, analyticsEventIds, {
                event_name: 'wc_report_requested',
                user_id: userId,
                company_id: companyId,
                entity_type: 'report',
                entity_id: report.report_id || report.id,
                payload: {
                    report_type: 'dataset_export',
                    dataset_type,
                    format: file_format
                }
            }, 'wc_report_requested');

            await this.jobQueue.enqueue({
                type: 'dataset_export',
                reportId: report.id,
                companyId,
                datasetType: dataset_type,
                fileFormat: file_format
            });

            this.analytics.queuePendingDispatch(analyticsEventIds);
            return {
                report_id: report.id,
                status: report.status,
                records: report.records,
                download_url: null // will be available once completed
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get export source counts for a specific dataset type
     */
    async getExportSourceCount(companyId, datasetType) {
        const client = await this.database.connect();
        try {
            const count = await this._getDatasetCount(client, companyId, datasetType);
            return {
                dataset_type: datasetType,
                count,
                last_updated: new Date().toISOString()
            };
        } finally {
            client.release();
        }
    }

    /**
     * Get all export source counts in one call (consolidated)
     */
    async getAllExportSourceCounts(companyId) {
        const client = await this.database.connect();
        try {
            const result = await client.query(
                `
                    SELECT
                        (SELECT COUNT(*)::int FROM products WHERE company_id = $1 AND status <> 'archived') AS products,
                        (SELECT COUNT(*)::int FROM carbon_calculations WHERE company_id = $1) AS activity,
                        (SELECT COUNT(*)::int FROM carbon_calculations WHERE company_id = $1 AND calculation_type = 'audit') AS audit,
                        (SELECT COUNT(*)::int FROM company_members WHERE company_id = $1) AS users,
                        (SELECT COUNT(*)::int FROM reports WHERE company_id = $1) AS history
                `,
                [companyId]
            );

            return {
                products: Number(result.rows[0]?.products || 0),
                activity: Number(result.rows[0]?.activity || 0),
                audit: Number(result.rows[0]?.audit || 0),
                users: Number(result.rows[0]?.users || 0),
                history: Number(result.rows[0]?.history || 0)
            };
        } finally {
            client.release();
        }
    }

    /**
     * Quick status check for a single report (lightweight poll)
     */
    async getReportStatus(reportId, companyId) {
        const client = await this.database.connect();
        try {
            const query = `
                SELECT id, status, file_format, file_size_bytes, download_url, storage_key,
                       error_message, generated_at, updated_at
                FROM reports
                WHERE id = $1 AND company_id = $2
            `;
            const result = await client.query(query, [reportId, companyId]);
            if (result.rows.length === 0) return null;

            const row = result.rows[0];
            const hasFile = row.status === 'completed' && row.storage_key;
            return {
                id: row.id,
                status: row.status,
                file_format: row.file_format,
                file_size_bytes: row.file_size_bytes || 0,
                download_url: hasFile
                    ? (row.download_url || `/api/reports/${row.id}/download`)
                    : null,
                error_message: row.error_message,
                generated_at: row.generated_at,
                updated_at: row.updated_at
            };
        } finally {
            client.release();
        }
    }

    /**
     * Delete a report record and its file from storage
     */
    async deleteReport(reportId, companyId) {
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');

            // Fetch report to get file info before deleting
            const selectQuery = `
                SELECT id, storage_provider, storage_key
                FROM reports
                WHERE id = $1 AND company_id = $2
            `;
            const selectResult = await client.query(selectQuery, [reportId, companyId]);
            if (selectResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'REPORT_NOT_FOUND' };
            }

            const report = selectResult.rows[0];

            // Delete from DB
            await client.query('DELETE FROM reports WHERE id = $1 AND company_id = $2', [reportId, companyId]);

            await client.query('COMMIT');

            // Best-effort file cleanup (don't fail if file removal errors)
            if (report.storage_key && (report.storage_provider === 'local' || !report.storage_provider)) {
                try {
                    const filePath = path.resolve(this.uploadsRoot, report.storage_key);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (_) { /* ignore file cleanup errors */ }
            }

            return { success: true };
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

    _formatReportItem(row) {
        const hasFile = row.status === 'completed' && row.storage_key;
        return {
            id: row.id,
            report_type: row.report_type,
            title: row.title,
            description: row.description,
            status: row.status,
            file_format: row.file_format,
            records: row.records || 0,
            file_size_bytes: row.file_size_bytes || 0,
            dataset_type: row.dataset_type,
            storage_provider: row.storage_provider,
            storage_key: row.storage_key,
            original_filename: row.original_filename,
            download_url: hasFile
                ? (row.download_url || `/api/reports/${row.id}/download`)
                : null,
            error_message: row.error_message,
            target_market: row.target_market,
            period_start: row.period_start,
            period_end: row.period_end,
            generated_at: row.generated_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            metadata: row.metadata || {}
        };
    }

    async _getDatasetCount(client, companyId, datasetType) {
        const countQueries = {
            'product': `SELECT COUNT(*) as count FROM products WHERE company_id = $1 AND status <> 'archived'`,
            'activity': `SELECT COUNT(*) as count FROM carbon_calculations WHERE company_id = $1`,
            'audit': `SELECT COUNT(*) as count FROM carbon_calculations WHERE company_id = $1 AND calculation_type = 'audit'`,
            'users': `SELECT COUNT(*) as count FROM company_members WHERE company_id = $1`,
            'history': `SELECT COUNT(*) as count FROM reports WHERE company_id = $1`,
            'analytics': `SELECT COUNT(*) as count FROM carbon_targets WHERE company_id = $1`,
            'company': `SELECT 1 as count`
        };

        const countQuery = countQueries[datasetType];
        if (!countQuery) {
            return 0;
        }

        const params = datasetType === 'company' ? [] : [companyId];
        const result = await client.query(countQuery, params);
        return parseInt(result.rows[0].count) || 0;
    }

    // =============================================
    // REAL DATA QUERIES (per dataset type)
    // =============================================

    /**
     * Get the SELECT query + columns for each dataset type.
     * Returns { query, params, columns }
     */
    _getDatasetQuery(companyId, datasetType) {
        const queries = {
            'product': {
                query: `
                    SELECT p.sku, p.name, p.category, p.status, p.weight_kg,
                           p.total_co2e, p.materials_co2e, p.production_co2e,
                           p.transport_co2e, p.packaging_co2e,
                           p.data_confidence_score,
                           ps.id AS calculation_id,
                           ps.version AS calculation_version,
                           ps.calculated_at,
                           ps.engine_version,
                           ps.methodology_version,
                           ps.factor_registry_version,
                           ps.gwp_basis,
                           ps.canonical_input_hash,
                           ps.is_legacy,
                           p.created_at
                    FROM products p
                    INNER JOIN latest_product_assessment_snapshots ps
                      ON ps.product_id = p.id AND ps.company_id = p.company_id
                    WHERE p.company_id = $1
                      AND p.status <> 'archived'
                    ORDER BY p.created_at DESC
                `,
                params: [companyId],
                columns: ['sku', 'name', 'category', 'status', 'weight_kg',
                          'total_co2e', 'materials_co2e', 'production_co2e',
                          'transport_co2e', 'packaging_co2e',
                          'data_confidence_score', 'calculation_id',
                          'calculation_version', 'calculated_at', 'engine_version',
                          'methodology_version', 'factor_registry_version', 'gwp_basis',
                          'canonical_input_hash', 'is_legacy', 'created_at']
            },
            'activity': {
                query: `
                    SELECT cc.id AS calculation_id,
                           cc.calculation_type, cc.period_start, cc.period_end,
                           cc.materials_co2e, cc.production_co2e, cc.transport_co2e,
                           cc.packaging_co2e, cc.total_co2e, cc.methodology,
                           cc.emission_factor_version, cc.engine_version,
                           cc.methodology_version, cc.factor_registry_version,
                           cc.gwp_basis, cc.calculated_at, cc.canonical_input_hash,
                           cc.is_legacy, cc.notes, cc.created_at,
                           p.name AS product_name, p.sku AS product_sku
                    FROM carbon_calculations cc
                    LEFT JOIN products p ON p.id = cc.product_id
                    WHERE cc.company_id = $1
                    ORDER BY cc.created_at DESC
                `,
                params: [companyId],
                columns: ['calculation_id', 'calculation_type', 'period_start', 'period_end',
                          'materials_co2e', 'production_co2e', 'transport_co2e',
                          'packaging_co2e', 'total_co2e', 'methodology',
                          'emission_factor_version', 'engine_version',
                          'methodology_version', 'factor_registry_version', 'gwp_basis',
                          'calculated_at', 'canonical_input_hash', 'is_legacy',
                          'notes', 'created_at',
                          'product_name', 'product_sku']
            },
            'audit': {
                query: `
                    SELECT cc.id AS calculation_id,
                           cc.calculation_type, cc.period_start, cc.period_end,
                           cc.materials_co2e, cc.production_co2e, cc.transport_co2e,
                           cc.packaging_co2e, cc.total_co2e, cc.methodology,
                           cc.emission_factor_version, cc.engine_version,
                           cc.methodology_version, cc.factor_registry_version,
                           cc.gwp_basis, cc.calculated_at, cc.canonical_input_hash,
                           cc.is_legacy, cc.notes, cc.created_at,
                           p.name AS product_name, p.sku AS product_sku
                    FROM carbon_calculations cc
                    LEFT JOIN products p ON p.id = cc.product_id
                    WHERE cc.company_id = $1 AND cc.calculation_type = 'audit'
                    ORDER BY cc.created_at DESC
                `,
                params: [companyId],
                columns: ['calculation_id', 'calculation_type', 'period_start', 'period_end',
                          'materials_co2e', 'production_co2e', 'transport_co2e',
                          'packaging_co2e', 'total_co2e', 'methodology',
                          'emission_factor_version', 'engine_version',
                          'methodology_version', 'factor_registry_version', 'gwp_basis',
                          'calculated_at', 'canonical_input_hash', 'is_legacy',
                          'notes', 'created_at',
                          'product_name', 'product_sku']
            },
            'users': {
                query: `
                    SELECT u.email, u.full_name, cm.role, cm.status,
                           cm.last_login, cm.created_at
                    FROM company_members cm
                    JOIN users u ON u.id = cm.user_id
                    WHERE cm.company_id = $1
                    ORDER BY cm.created_at DESC
                `,
                params: [companyId],
                columns: ['email', 'full_name', 'role', 'status', 'last_login', 'created_at']
            },
            'history': {
                query: `
                    SELECT r.title, r.report_type, r.dataset_type, r.status,
                           r.file_format, r.records, r.file_size_bytes,
                           r.generated_at, r.created_at
                    FROM reports r
                    WHERE r.company_id = $1
                    ORDER BY r.created_at DESC
                `,
                params: [companyId],
                columns: ['title', 'report_type', 'dataset_type', 'status',
                          'file_format', 'records', 'file_size_bytes',
                          'generated_at', 'created_at']
            },
            'analytics': {
                query: `
                    SELECT ct.year, ct.month, ct.target_co2e, ct.actual_co2e,
                           ct.reduction_percentage, ct.created_at
                    FROM carbon_targets ct
                    WHERE ct.company_id = $1
                    ORDER BY ct.year DESC, ct.month DESC
                `,
                params: [companyId],
                columns: ['year', 'month', 'target_co2e', 'actual_co2e',
                          'reduction_percentage', 'created_at']
            },
            'company': {
                query: `
                    SELECT c.name, c.industry, c.country, c.created_at
                    FROM companies c
                    JOIN company_members cm ON cm.company_id = c.id
                    WHERE cm.company_id = (
                        SELECT company_id FROM company_members WHERE company_id = $1 LIMIT 1
                    )
                    LIMIT 1
                `,
                params: [companyId],
                columns: ['name', 'industry', 'country', 'created_at']
            }
        };

        return queries[datasetType] || null;
    }

    /**
     * Get raw dataset rows as JSON (for FE XLSX generation)
     */
    async getExportData(companyId, datasetType) {
        const datasetDef = this._getDatasetQuery(companyId, datasetType);
        if (!datasetDef) {
            return { columns: [], rows: [], total: 0 };
        }

        const client = await this.database.connect();
        try {
            const result = await client.query(datasetDef.query, datasetDef.params);
            return {
                dataset_type: datasetType,
                columns: datasetDef.columns,
                rows: result.rows,
                total: result.rows.length
            };
        } finally {
            client.release();
        }
    }

    // =============================================
    // CSV HELPERS
    // =============================================

    /**
     * Escape a value for CSV: wrap in quotes if it contains comma, newline, or quote
     */
    _csvEscape(val) {
        if (val === null || val === undefined) return '';
        let str = String(val);
        // Neutralise CSV/formula injection: Excel/Sheets execute cells starting with
        // = + - @ (or tab/CR). Prefix with an apostrophe unless the value is a plain
        // number (so legitimate negatives like -5.2 are preserved).
        if (/^[=+\-@\t\r]/.test(str) && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(str.trim())) {
            str = "'" + str;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    /**
     * Convert rows + columns to CSV string
     */
    _rowsToCsv(columns, rows) {
        const header = columns.map(c => this._csvEscape(c)).join(',');
        const lines = rows.map(row =>
            columns.map(col => this._csvEscape(row[col])).join(',')
        );
        return header + '\n' + lines.join('\n');
    }

    async _writeCsvFile(filePath, columns, rows) {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

        const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
        let fileSize = 0;
        const completionPromise = new Promise((resolve, reject) => {
            stream.once('finish', () => resolve(fileSize));
            stream.once('error', reject);
        });

        const writeLine = async (line) => {
            fileSize += Buffer.byteLength(line, 'utf8');
            if (!stream.write(line)) {
                await once(stream, 'drain');
            }
        };

        try {
            await writeLine(`${columns.map((column) => this._csvEscape(column)).join(',')}\n`);
            for (const row of rows) {
                await writeLine(`${columns.map((column) => this._csvEscape(row[column])).join(',')}\n`);
            }
            stream.end();
            return await completionPromise;
        } catch (error) {
            stream.destroy(error);
            throw error;
        }
    }

    // =============================================
    // REAL FILE GENERATION
    // =============================================

    /**
     * Generate a real CSV file from SQL data and save to local storage.
     * Updates the report record with actual file info.
     */
    async _generateRealExport(reportId, companyId, datasetType, fileFormat) {
        const client = await this.database.connect();
        try {
            // 1. Query real data
            const datasetDef = this._getDatasetQuery(companyId, datasetType);
            if (!datasetDef) {
                throw new Error(`Unknown dataset type: ${datasetType}`);
            }

            const result = await client.query(datasetDef.query, datasetDef.params);
            const rows = result.rows;
            const recordCount = rows.length;

            // 2. Write CSV content to local storage without building one giant string in memory
            const ext = 'csv'; // Phase 1: always CSV for reliability
            const storageKey = `reports/${companyId}/exports/${datasetType}_${reportId}.${ext}`;
            const filePath = path.resolve(this.uploadsRoot, storageKey);
            const fileSize = await this._writeCsvFile(filePath, datasetDef.columns, rows);
            const originalFilename = `${datasetType}_export_${new Date().toISOString().split('T')[0]}.${ext}`;

            // 4. Update report record with real file info
            await client.query(`
                UPDATE reports
                SET status = 'completed',
                    storage_provider = 'local',
                    storage_key = $1,
                    original_filename = $2,
                    download_url = $3,
                    file_size_bytes = $4,
                    records = $5,
                    file_format = 'csv',
                    generated_at = NOW(),
                    updated_at = NOW()
                WHERE id = $6 AND company_id = $7
            `, [storageKey, originalFilename, `/api/reports/${reportId}/download`, fileSize, recordCount, reportId, companyId]);

            await safeTrackAnalyticsEvent({
                event_name: 'wc_report_generated',
                company_id: companyId,
                entity_type: 'report',
                entity_id: reportId,
                payload: {
                    report_type: 'dataset_export',
                    dataset_type: datasetType,
                    format: fileFormat || 'csv'
                }
            }, 'wc_report_generated');

        } catch (error) {
            // Mark as failed
            await client.query(`
                UPDATE reports
                SET status = 'failed', error_message = $1, updated_at = NOW()
                WHERE id = $2
            `, [error.message, reportId]).catch(() => {});
            await safeTrackAnalyticsEvent({
                event_name: 'wc_report_generation_failed',
                company_id: companyId,
                entity_type: 'report',
                entity_id: reportId,
                payload: {
                    report_type: 'dataset_export',
                    dataset_type: datasetType,
                    format: fileFormat || 'csv',
                    error_code: String(error.code || error.message || 'report_generation_failed')
                }
            }, 'wc_report_generation_failed');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Generate real report file (manual report type).
     * PDF types (product_carbon, batch_export, facility_emission, compliance) use pdfkit.
     * Legacy types (carbon_audit, sustainability, export_declaration) produce CSV.
     */
    async _generateRealReport(reportId, companyId) {
        const client = await this.database.connect();
        try {
            // Get report metadata
            const reportRes = await client.query(
                'SELECT report_type, period_start, period_end, target_market, file_format FROM reports WHERE id = $1 AND company_id = $2',
                [reportId, companyId]
            );
            if (reportRes.rows.length === 0) throw new Error('Report not found');

            const report = reportRes.rows[0];
            const isPdf = PDF_REPORT_TYPES.has(report.report_type) || report.file_format === 'pdf';

            let storageKey, filePath, fileSize, recordCount, originalFilename, ext;

            if (isPdf) {
                // ── PDF path ───────────────────────────────────────────────
                ext = 'pdf';
                storageKey = `reports/${companyId}/${new Date().getFullYear()}/${reportId}.${ext}`;
                filePath = path.resolve(this.uploadsRoot, storageKey);

                const { buffer, recordCount: rc } = await this.pdfService.generatePdf(report.report_type, companyId);
                recordCount = rc;

                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, buffer);
                fileSize = buffer.length;

                originalFilename = `${report.report_type}_${new Date().toISOString().split('T')[0]}.pdf`;
            } else {
                // ── CSV path ───────────────────────────────────────────────
                let columns, rows;

                if (report.report_type === 'carbon_audit' || report.report_type === 'sustainability') {
                    const dataRes = await client.query(`
                        SELECT p.sku, p.name, p.category, p.status, p.weight_kg,
                               p.total_co2e, p.materials_co2e, p.production_co2e,
                               p.transport_co2e, p.packaging_co2e,
                               ps.id AS calculation_id,
                               ps.version AS calculation_version,
                               ps.calculated_at,
                               ps.engine_version,
                               ps.methodology_version,
                               ps.factor_registry_version,
                               ps.gwp_basis,
                               ps.canonical_input_hash,
                               ps.is_legacy,
                               p.created_at
                        FROM products p
                        INNER JOIN latest_product_assessment_snapshots ps
                          ON ps.product_id = p.id AND ps.company_id = p.company_id
                        WHERE p.company_id = $1 AND p.status <> 'archived'
                        ORDER BY p.total_co2e DESC NULLS LAST
                    `, [companyId]);
                    columns = ['sku', 'name', 'category', 'status', 'weight_kg',
                               'total_co2e', 'materials_co2e', 'production_co2e',
                               'transport_co2e', 'packaging_co2e', 'calculation_id',
                               'calculation_version', 'calculated_at', 'engine_version',
                               'methodology_version', 'factor_registry_version', 'gwp_basis',
                               'canonical_input_hash', 'is_legacy', 'created_at'];
                    rows = dataRes.rows;
                } else if (report.report_type === 'export_declaration') {
                    const dataRes = await client.query(`
                        SELECT em.market_code, em.market_name, em.status, em.score,
                               em.verification_status, em.verification_date, em.created_at
                        FROM export_markets em
                        WHERE em.company_id = $1
                        ORDER BY em.market_code
                    `, [companyId]);
                    columns = ['market_code', 'market_name', 'status', 'score',
                               'verification_status', 'verification_date', 'created_at'];
                    rows = dataRes.rows;
                } else {
                    const dataRes = await client.query(`
                        SELECT p.sku, p.name, p.category, p.total_co2e,
                               ps.id AS calculation_id,
                               ps.version AS calculation_version,
                               ps.calculated_at,
                               ps.engine_version,
                               ps.methodology_version,
                               ps.factor_registry_version,
                               ps.gwp_basis,
                               ps.canonical_input_hash,
                               ps.is_legacy,
                               p.created_at
                        FROM products p
                        INNER JOIN latest_product_assessment_snapshots ps
                          ON ps.product_id = p.id AND ps.company_id = p.company_id
                        WHERE p.company_id = $1 AND p.status <> 'archived'
                        ORDER BY p.created_at DESC
                    `, [companyId]);
                    columns = ['sku', 'name', 'category', 'total_co2e',
                               'calculation_id', 'calculation_version', 'calculated_at',
                               'engine_version', 'methodology_version',
                               'factor_registry_version', 'gwp_basis',
                               'canonical_input_hash', 'is_legacy', 'created_at'];
                    rows = dataRes.rows;
                }

                ext = 'csv';
                storageKey = `reports/${companyId}/${new Date().getFullYear()}/${reportId}.${ext}`;
                filePath = path.resolve(this.uploadsRoot, storageKey);
                fileSize = await this._writeCsvFile(filePath, columns, rows);
                recordCount = rows.length;
                originalFilename = `report_${reportId}_${new Date().toISOString().split('T')[0]}.${ext}`;
            }

            await client.query(`
                UPDATE reports
                SET status = 'completed',
                    storage_provider = 'local',
                    storage_key = $1,
                    original_filename = $2,
                    download_url = $3,
                    file_size_bytes = $4,
                    records = $5,
                    file_format = $8,
                    generated_at = NOW(),
                    updated_at = NOW()
                WHERE id = $6 AND company_id = $7
            `, [storageKey, originalFilename, `/api/reports/${reportId}/download`, fileSize, recordCount, reportId, companyId, ext]);

            await safeTrackAnalyticsEvent({
                event_name: 'wc_report_generated',
                company_id: companyId,
                entity_type: 'report',
                entity_id: reportId,
                payload: {
                    report_type: report.report_type,
                    format: report.file_format || 'csv'
                }
            }, 'wc_report_generated');

        } catch (error) {
            await client.query(`
                UPDATE reports
                SET status = 'failed', error_message = $1, updated_at = NOW()
                WHERE id = $2
            `, [error.message, reportId]).catch(() => {});
            await safeTrackAnalyticsEvent({
                event_name: 'wc_report_generation_failed',
                company_id: companyId,
                entity_type: 'report',
                entity_id: reportId,
                payload: {
                    report_type: 'manual_report',
                    format: 'csv',
                    error_code: String(error.code || error.message || 'report_generation_failed')
                }
            }, 'wc_report_generation_failed');
            throw error;
        } finally {
            client.release();
        }
    }
}

const reportsService = new ReportsService();

module.exports = reportsService;
module.exports.ReportsService = ReportsService;
module.exports.createReportsService = (dependencies) => new ReportsService(dependencies);
