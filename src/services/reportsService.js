const pool = require('../config/database');
const path = require('path');
const fs = require('fs');

class ReportsService {
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

        const client = await pool.connect();
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
            const countResult = await client.query(countQuery, params);
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
        const client = await pool.connect();
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

        const client = await pool.connect();
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

            // Generate real report file asynchronously
            this._generateRealReport(report.id, companyId).catch(err => {
                console.error('Background report generation failed:', err);
            });

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

    /**
     * Update report status (processing | completed | failed)
     */
    async updateReportStatus(reportId, companyId, userId, newStatus) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const selectQuery = `
                SELECT id, status FROM reports
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

            await client.query('COMMIT');

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
     * Check if report file is ready for download
     */
    async checkReportFileStatus(reportId, companyId) {
        const client = await pool.connect();
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

        const client = await pool.connect();
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

            // Generate real CSV export asynchronously
            this._generateRealExport(report.id, companyId, dataset_type, file_format).catch(err => {
                console.error('Background dataset export failed:', err);
            });

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
        const client = await pool.connect();
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
        const client = await pool.connect();
        try {
            const types = ['product', 'activity', 'audit', 'users', 'history'];
            const results = {};
            for (const type of types) {
                results[type === 'product' ? 'products' : type] = await this._getDatasetCount(client, companyId, type);
            }
            return results;
        } finally {
            client.release();
        }
    }

    /**
     * Quick status check for a single report (lightweight poll)
     */
    async getReportStatus(reportId, companyId) {
        const client = await pool.connect();
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
        const client = await pool.connect();
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
                    const fs = require('fs');
                    const filePath = path.resolve(process.cwd(), 'uploads', report.storage_key);
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
                           p.data_confidence_score, p.created_at
                    FROM products p
                    WHERE p.company_id = $1
                      AND p.status <> 'archived'
                    ORDER BY p.created_at DESC
                `,
                params: [companyId],
                columns: ['sku', 'name', 'category', 'status', 'weight_kg',
                          'total_co2e', 'materials_co2e', 'production_co2e',
                          'transport_co2e', 'packaging_co2e',
                          'data_confidence_score', 'created_at']
            },
            'activity': {
                query: `
                    SELECT cc.calculation_type, cc.period_start, cc.period_end,
                           cc.materials_co2e, cc.production_co2e, cc.transport_co2e,
                           cc.packaging_co2e, cc.total_co2e, cc.methodology,
                           cc.emission_factor_version, cc.notes, cc.created_at,
                           p.name AS product_name, p.sku AS product_sku
                    FROM carbon_calculations cc
                    LEFT JOIN products p ON p.id = cc.product_id
                    WHERE cc.company_id = $1
                    ORDER BY cc.created_at DESC
                `,
                params: [companyId],
                columns: ['calculation_type', 'period_start', 'period_end',
                          'materials_co2e', 'production_co2e', 'transport_co2e',
                          'packaging_co2e', 'total_co2e', 'methodology',
                          'emission_factor_version', 'notes', 'created_at',
                          'product_name', 'product_sku']
            },
            'audit': {
                query: `
                    SELECT cc.calculation_type, cc.period_start, cc.period_end,
                           cc.materials_co2e, cc.production_co2e, cc.transport_co2e,
                           cc.packaging_co2e, cc.total_co2e, cc.methodology,
                           cc.emission_factor_version, cc.notes, cc.created_at,
                           p.name AS product_name, p.sku AS product_sku
                    FROM carbon_calculations cc
                    LEFT JOIN products p ON p.id = cc.product_id
                    WHERE cc.company_id = $1 AND cc.calculation_type = 'audit'
                    ORDER BY cc.created_at DESC
                `,
                params: [companyId],
                columns: ['calculation_type', 'period_start', 'period_end',
                          'materials_co2e', 'production_co2e', 'transport_co2e',
                          'packaging_co2e', 'total_co2e', 'methodology',
                          'emission_factor_version', 'notes', 'created_at',
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

        const client = await pool.connect();
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
        const str = String(val);
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

    // =============================================
    // REAL FILE GENERATION
    // =============================================

    /**
     * Generate a real CSV file from SQL data and save to local storage.
     * Updates the report record with actual file info.
     */
    async _generateRealExport(reportId, companyId, datasetType, fileFormat) {
        const client = await pool.connect();
        try {
            // 1. Query real data
            const datasetDef = this._getDatasetQuery(companyId, datasetType);
            if (!datasetDef) {
                throw new Error(`Unknown dataset type: ${datasetType}`);
            }

            const result = await client.query(datasetDef.query, datasetDef.params);
            const rows = result.rows;
            const recordCount = rows.length;

            // 2. Generate CSV content (CSV is the reliable Phase 1 format)
            const csvContent = this._rowsToCsv(datasetDef.columns, rows);
            const csvBuffer = Buffer.from(csvContent, 'utf-8');

            // 3. Write file to local storage
            const ext = 'csv'; // Phase 1: always CSV for reliability
            const storageKey = `reports/${companyId}/exports/${datasetType}_${reportId}.${ext}`;
            const uploadsDir = path.resolve(process.cwd(), 'uploads');
            const filePath = path.resolve(uploadsDir, storageKey);

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, csvBuffer);

            const fileSize = csvBuffer.length;
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

            console.log(`[Export] Generated real CSV for report ${reportId}: ${recordCount} rows, ${fileSize} bytes`);
        } catch (error) {
            // Mark as failed
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

    /**
     * Generate real report file (manual report type).
     * For now produces a CSV summary; Phase 2 will add XLSX/PDF.
     */
    async _generateRealReport(reportId, companyId) {
        const client = await pool.connect();
        try {
            // Get report metadata
            const reportRes = await client.query(
                'SELECT report_type, period_start, period_end, target_market, file_format FROM reports WHERE id = $1 AND company_id = $2',
                [reportId, companyId]
            );
            if (reportRes.rows.length === 0) throw new Error('Report not found');

            const report = reportRes.rows[0];

            // Build a summary CSV based on report type
            let columns, rows;

            if (report.report_type === 'carbon_audit' || report.report_type === 'sustainability') {
                // Products + CO2 summary
                const dataRes = await client.query(`
                    SELECT p.sku, p.name, p.category, p.status, p.weight_kg,
                           p.total_co2e, p.materials_co2e, p.production_co2e,
                           p.transport_co2e, p.packaging_co2e, p.created_at
                    FROM products p
                    WHERE p.company_id = $1
                      AND p.status <> 'archived'
                    ORDER BY p.total_co2e DESC NULLS LAST
                `, [companyId]);
                columns = ['sku', 'name', 'category', 'status', 'weight_kg',
                            'total_co2e', 'materials_co2e', 'production_co2e',
                            'transport_co2e', 'packaging_co2e', 'created_at'];
                rows = dataRes.rows;
            } else if (report.report_type === 'compliance' || report.report_type === 'export_declaration') {
                // Export compliance data
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
                // Generic: list products
                const dataRes = await client.query(`
                    SELECT p.sku, p.name, p.category, p.total_co2e, p.created_at
                    FROM products p
                    WHERE p.company_id = $1
                      AND p.status <> 'archived'
                    ORDER BY p.created_at DESC
                `, [companyId]);
                columns = ['sku', 'name', 'category', 'total_co2e', 'created_at'];
                rows = dataRes.rows;
            }

            const csvContent = this._rowsToCsv(columns, rows);
            const csvBuffer = Buffer.from(csvContent, 'utf-8');

            const storageKey = `reports/${companyId}/${new Date().getFullYear()}/${reportId}.csv`;
            const filePath = path.resolve(process.cwd(), 'uploads', storageKey);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, csvBuffer);

            const fileSize = csvBuffer.length;
            const originalFilename = `report_${reportId}_${new Date().toISOString().split('T')[0]}.csv`;

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
            `, [storageKey, originalFilename, `/api/reports/${reportId}/download`, fileSize, rows.length, reportId, companyId]);

            console.log(`[Report] Generated real CSV for report ${reportId}: ${rows.length} rows, ${fileSize} bytes`);
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

module.exports = new ReportsService();
