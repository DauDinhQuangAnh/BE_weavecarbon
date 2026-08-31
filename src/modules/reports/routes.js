const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticate, requireRole } = require('../shared/security');
const { UPLOADS_ROOT } = require('../shared/runtime');
const validate = require('../shared/validation');
const reportsService = require('./service');
const analyticsService = require('../shared/analytics');
const { logAuditTrail } = require('../shared/auditing');
const logger = require('../shared/logger');
const {
    listReportsValidation,
    getReportByIdValidation,
    createReportValidation,
    updateReportStatusValidation,
    createDatasetExportValidation
} = require('./validation');

const ENABLE_DEV_PLACEHOLDER_DOWNLOAD =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_DOWNLOAD_PLACEHOLDER === 'true';

function isWithinUploadsRoot(filePath) {
    const relativePath = path.relative(UPLOADS_ROOT, filePath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function writeDevPlaceholderReport(filePath, reportId, filename, format) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    const lowerFormat = String(format || '').toLowerCase();
    const generatedAt = new Date().toISOString();

    if (lowerFormat === 'csv') {
        const csv = [
            'report_id,file_name,generated_at,note',
            `${reportId},${filename},${generatedAt},placeholder-generated-in-dev`
        ].join('\n');
        await fs.promises.writeFile(filePath, csv);
        return;
    }

    const text = [
        'WeaveCarbon Dev Placeholder Report',
        `Report ID: ${reportId}`,
        `File: ${filename}`,
        `Format: ${lowerFormat || 'unknown'}`,
        `Generated: ${generatedAt}`
    ].join('\n');
    await fs.promises.writeFile(filePath, text);
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
            logger.error({ err: error }, 'Error listing reports');
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
            await logAuditTrail({
                companyId,
                userId,
                dataGroup: 'reports',
                changedField: 'report.generated',
                newValue: result?.id || exportData.dataset_type,
                reason: 'report.dataset_export',
                notes: `Created ${exportData.dataset_type} dataset export (${exportData.file_format})`
            });

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error({ err: error }, 'Error creating dataset export');
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
            await logAuditTrail({
                companyId,
                userId,
                dataGroup: 'reports',
                changedField: 'report.generated',
                newValue: result?.id || exportData.dataset_type,
                reason: 'report.export_job',
                notes: `Created ${exportData.dataset_type} export job (${exportData.file_format})`
            });

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error({ err: error }, 'Error creating dataset export (fallback)');
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
            logger.error({ err: error }, 'Error fetching all export source counts');
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
            logger.error({ err: error }, 'Error fetching export source count');
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
            logger.error({ err: error }, 'Error fetching export data');
            next(error);
        }
    }
);

router.get(
    '/v2/template',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            if (!req.companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const template = await reportsService.getActiveV2Template();
            return res.status(200).json({
                success: true,
                data: template
            });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    '/v2/snapshots',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            if (!req.companyId) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NO_COMPANY',
                        message: 'No company associated with this user'
                    }
                });
            }

            const snapshot = await reportsService.createV2Snapshot(req.companyId, req.userId, req.body || {});
            await logAuditTrail({
                companyId: req.companyId,
                userId: req.userId,
                dataGroup: 'reports',
                changedField: 'report.generated',
                newValue: snapshot?.id || null,
                reason: 'report.v2_snapshot',
                notes: 'Created V2 audit snapshot'
            });
            return res.status(201).json({
                success: true,
                data: snapshot
            });
        } catch (error) {
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
            logger.error({ err: error }, 'Error fetching report');
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
            logger.error({ err: error }, 'Error fetching report status');
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
            const report = await reportsService.getReportById(reportId, companyId);

            await analyticsService.trackEvent({
                event_name: 'wc_report_downloaded',
                user_id: req.userId,
                company_id: companyId,
                entity_type: 'report',
                entity_id: reportId,
                payload: {
                    report_type: report.report_type,
                    format: fileStatus.file_format || 'csv',
                    report_status: fileStatus.status || 'completed'
                }
            }).catch((error) => {
                logger.error({ err: error }, '[reports] Failed to track wc_report_downloaded');
            });
            await logAuditTrail({
                companyId,
                userId: req.userId,
                dataGroup: 'reports',
                changedField: 'report.downloaded',
                oldValue: reportId,
                newValue: originalFilename,
                reason: 'report.download',
                notes: `Downloaded report ${originalFilename}`
            });

            if (storageProvider === 'local') {
                // Resolve file from local storage
                const filePath = path.resolve(UPLOADS_ROOT, storageKey);

                // Prevent path traversal
                if (!isWithinUploadsRoot(filePath)) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_PATH', message: 'Invalid storage path' }
                    });
                }

                if (!(await fileExists(filePath))) {
                    if (ENABLE_DEV_PLACEHOLDER_DOWNLOAD) {
                        await writeDevPlaceholderReport(
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
                stream.on('error', next);
                return stream.pipe(res);
            }

            return res.status(501).json({
                success: false,
                error: {
                    code: 'STORAGE_NOT_IMPLEMENTED',
                    message: `Storage provider '${storageProvider}' download not implemented yet`
                }
            });

        } catch (error) {
            logger.error({ err: error }, 'Error downloading report');
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
            await logAuditTrail({
                companyId,
                userId,
                dataGroup: 'reports',
                changedField: 'report.generated',
                newValue: result?.id || reportData.title || reportData.report_type,
                reason: 'report.create',
                notes: `Created report ${reportData.title || reportData.report_type}`
            });

            return res.status(202).json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error({ err: error }, 'Error creating report');
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
            logger.error({ err: error }, 'Error deleting report');
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
            logger.error({ err: error }, 'Error updating report status');
            next(error);
        }
    }
);

module.exports = router;
