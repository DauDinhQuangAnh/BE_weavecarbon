const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validator');
const reportsService = require('../services/reportsService');
const {
    listReportsValidation,
    getReportByIdValidation,
    createReportValidation,
    updateReportStatusValidation,
    createDatasetExportValidation
} = require('../validators/reportsValidators');

const ENABLE_DEV_PLACEHOLDER_DOWNLOAD =
    process.env.NODE_ENV !== 'production' &&
    process.env.DISABLE_DOWNLOAD_PLACEHOLDER !== 'true';

function writeDevPlaceholderReport(filePath, reportId, filename, format) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const lowerFormat = String(format || '').toLowerCase();
    const generatedAt = new Date().toISOString();

    if (lowerFormat === 'csv') {
        const csv = [
            'report_id,file_name,generated_at,note',
            `${reportId},${filename},${generatedAt},placeholder-generated-in-dev`
        ].join('\n');
        fs.writeFileSync(filePath, csv);
        return;
    }

    const text = [
        'WeaveCarbon Dev Placeholder Report',
        `Report ID: ${reportId}`,
        `File: ${filename}`,
        `Format: ${lowerFormat || 'unknown'}`,
        `Generated: ${generatedAt}`
    ].join('\n');
    fs.writeFileSync(filePath, text);
}

/**
 * GET /api/reports
 * List reports for current company
 * Requires: Authentication + B2B role
 */
router.get(
    '/',
    authenticate,
    requireRole('b2b'),
    listReportsValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;

            // Check if user has company
            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            // Extract filters from query params
            const filters = {
                search: req.query.search,
                type: req.query.type,
                status: req.query.status,
                date_from: req.query.date_from,
                date_to: req.query.date_to,
                page: parseInt(req.query.page) || 1,
                page_size: parseInt(req.query.page_size) || 20,
                sort_by: req.query.sort_by || 'created_at',
                sort_order: req.query.sort_order || 'desc'
            };

            const result = await reportsService.listReports(companyId, filters);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error listing reports:', error);
            next(error);
        }
    }
);

/**
 * POST /api/reports/exports
 * Unified Export Pipeline - all dataset exports go through here
 * Requires: Authentication + B2B role
 */
router.post(
    '/exports',
    authenticate,
    requireRole('b2b'),
    createDatasetExportValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const userId = req.userId;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const exportData = {
                dataset_type: req.body.dataset_type,
                file_format: req.body.file_format || 'csv',
                title: req.body.title
            };

            const result = await reportsService.createDatasetExport(companyId, userId, exportData);

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error creating dataset export:', error);
            next(error);
        }
    }
);

/**
 * POST /api/reports/export-jobs
 * Fallback compatible alias for unified export pipeline
 */
router.post(
    '/export-jobs',
    authenticate,
    requireRole('b2b'),
    createDatasetExportValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const userId = req.userId;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const exportData = {
                dataset_type: req.body.dataset_type,
                file_format: req.body.file_format || 'csv',
                title: req.body.title
            };

            const result = await reportsService.createDatasetExport(companyId, userId, exportData);

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error creating dataset export (fallback):', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/export-sources
 * Get all export source counts in one call (consolidated)
 * Requires: Authentication + B2B role
 */
router.get(
    '/export-sources',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            const companyId = req.companyId;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const result = await reportsService.getAllExportSourceCounts(companyId);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error fetching all export source counts:', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/export-sources/:type
 * Get record count for a specific export source
 * Supported types: products, activity, audit, users, history
 */
router.get(
    '/export-sources/:type',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const datasetType = req.params.type;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            // Map plural route name to dataset_type
            const typeMap = {
                'products': 'product',
                'product': 'product',
                'activity': 'activity',
                'audit': 'audit',
                'users': 'users',
                'history': 'history',
                'analytics': 'analytics',
                'company': 'company'
            };

            const mappedType = typeMap[datasetType];
            if (!mappedType) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_SOURCE_TYPE',
                        message: `Invalid export source type: ${datasetType}. Valid types: products, activity, audit, users, history, analytics, company`
                    }
                });
            }

            const result = await reportsService.getExportSourceCount(companyId, mappedType);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error fetching export source count:', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/export-data/:type
 * Get raw dataset as JSON (for FE to generate XLSX/CSV client-side)
 * Supported types: product, activity, audit, users, history, analytics, company
 * Requires: Authentication + B2B role
 */
router.get(
    '/export-data/:type',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const datasetType = req.params.type;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const typeMap = {
                'products': 'product',
                'product': 'product',
                'activity': 'activity',
                'audit': 'audit',
                'users': 'users',
                'history': 'history',
                'analytics': 'analytics',
                'company': 'company'
            };

            const mappedType = typeMap[datasetType];
            if (!mappedType) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_SOURCE_TYPE',
                        message: `Invalid dataset type: ${datasetType}. Valid types: product, activity, audit, users, history, analytics, company`
                    }
                });
            }

            const result = await reportsService.getExportData(companyId, mappedType);

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error fetching export data:', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/:id
 * Get report detail
 * Requires: Authentication + B2B role
 */
router.get(
    '/:id',
    authenticate,
    requireRole('b2b'),
    getReportByIdValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const reportId = req.params.id;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const report = await reportsService.getReportById(reportId, companyId);

            if (!report) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'REPORT_NOT_FOUND',
                        message: 'Report not found'
                    }
                });
            }

            return res.status(200).json({
                success: true,
                data: report
            });
        } catch (error) {
            console.error('Error fetching report:', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/:id/status
 * Quick poll for a single report's status (lighter than full detail)
 * Requires: Authentication + B2B role
 */
router.get(
    '/:id/status',
    authenticate,
    requireRole('b2b'),
    getReportByIdValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const reportId = req.params.id;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const result = await reportsService.getReportStatus(reportId, companyId);

            if (!result) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'REPORT_NOT_FOUND',
                        message: 'Report not found'
                    }
                });
            }

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error fetching report status:', error);
            next(error);
        }
    }
);

/**
 * GET /api/reports/:id/download
 * Download generated report file
 * Requires: Authentication + B2B role
 */
router.get(
    '/:id/download',
    authenticate,
    requireRole('b2b'),
    getReportByIdValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const reportId = req.params.id;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const fileStatus = await reportsService.checkReportFileStatus(reportId, companyId);

            if (!fileStatus.exists) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'REPORT_NOT_FOUND',
                        message: 'Report not found'
                    }
                });
            }

            if (!fileStatus.isReady) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'REPORT_NOT_READY',
                        message: 'Report file is not ready yet. Current status: ' + fileStatus.status
                    }
                });
            }

            // Per section 4.6.1: must return binary file or 302 redirect, NOT JSON
            const mimeMap = {
                'pdf': 'application/pdf',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'csv': 'text/csv',
                'json': 'application/json'
            };

            const storageProvider = fileStatus.storage_provider || 'local';
            const storageKey = fileStatus.storage_key;
            const originalFilename = fileStatus.original_filename || `report.${fileStatus.file_format || 'pdf'}`;
            const mimeType = mimeMap[fileStatus.file_format] || 'application/octet-stream';

            if (storageProvider === 'local') {
                // Resolve file from local storage
                const uploadsDir = path.resolve(process.cwd(), 'uploads');
                const filePath = path.resolve(uploadsDir, storageKey);

                // Prevent path traversal
                if (!filePath.startsWith(uploadsDir)) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_PATH', message: 'Invalid storage path' }
                    });
                }

                if (!fs.existsSync(filePath)) {
                    if (ENABLE_DEV_PLACEHOLDER_DOWNLOAD) {
                        writeDevPlaceholderReport(
                            filePath,
                            reportId,
                            originalFilename,
                            fileStatus.file_format
                        );
                    } else {
                        return res.status(404).json({
                            success: false,
                            error: {
                                code: 'FILE_NOT_FOUND',
                                message: 'Report file not found on storage. It may still be generating.'
                            }
                        });
                    }
                }

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
                const stream = fs.createReadStream(filePath);
                return stream.pipe(res);
            }

            // For S3/GCS/Azure: generate signed URL and redirect (placeholder)
            // In production: use SDK to create a short-lived signed URL
            return res.status(501).json({
                success: false,
                error: {
                    code: 'STORAGE_NOT_IMPLEMENTED',
                    message: `Storage provider '${storageProvider}' download not implemented yet`
                }
            });

        } catch (error) {
            console.error('Error downloading report:', error);
            next(error);
        }
    }
);

/**
 * POST /api/reports
 * Create/generate a report job
 * Requires: Authentication + B2B role
 */
router.post(
    '/',
    authenticate,
    requireRole('b2b'),
    createReportValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const userId = req.userId;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const reportData = {
                report_type: req.body.report_type,
                title: req.body.title,
                description: req.body.description,
                period_start: req.body.period_start,
                period_end: req.body.period_end,
                target_market: req.body.target_market,
                file_format: req.body.file_format || 'xlsx',
                filters: req.body.filters || {}
            };

            const result = await reportsService.createReport(companyId, userId, reportData);

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error creating report:', error);
            next(error);
        }
    }
);

/**
 * DELETE /api/reports/:id
 * Delete a report record and its file
 * Requires: Authentication + B2B role
 */
router.delete(
    '/:id',
    authenticate,
    requireRole('b2b'),
    getReportByIdValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const reportId = req.params.id;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const result = await reportsService.deleteReport(reportId, companyId);

            if (!result.success) {
                if (result.error === 'REPORT_NOT_FOUND') {
                    return res.status(404).json({
                        success: false,
                        error: {
                            code: 'REPORT_NOT_FOUND',
                            message: 'Report not found'
                        }
                    });
                }
            }

            return res.status(200).json({
                success: true,
                message: 'Report deleted successfully'
            });
        } catch (error) {
            console.error('Error deleting report:', error);
            next(error);
        }
    }
);

/**
 * PATCH /api/reports/:id/status
 * Update report status (for approval workflow)
 * Requires: Authentication + B2B role
 */
router.patch(
    '/:id/status',
    authenticate,
    requireRole('b2b'),
    updateReportStatusValidation,
    validate,
    async (req, res, next) => {
        try {
            const companyId = req.companyId;
            const userId = req.userId;
            const reportId = req.params.id;
            const newStatus = req.body.status;

            if (!companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const result = await reportsService.updateReportStatus(
                reportId,
                companyId,
                userId,
                newStatus
            );

            if (!result.success) {
                if (result.error === 'REPORT_NOT_FOUND') {
                    return res.status(404).json({
                        success: false,
                        error: {
                            code: 'REPORT_NOT_FOUND',
                            message: 'Report not found'
                        }
                    });
                }

                if (result.error === 'INVALID_STATUS_TRANSITION') {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_STATUS_TRANSITION',
                            message: result.message
                        }
                    });
                }
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error updating report status:', error);
            next(error);
        }
    }
);

module.exports = router;
