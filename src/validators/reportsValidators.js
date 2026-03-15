const { body, query, param } = require('express-validator');

/**
 * Validation for GET /api/reports (list reports)
 */
const listReportsValidation = [
    query('search')
        .optional()
        .isString()
        .trim()
        .withMessage('Search must be a string'),

    query('type')
        .optional()
        .isIn(['carbon_audit', 'compliance', 'export_declaration', 'sustainability', 'dataset_export', 'manual', 'export_data'])
        .withMessage('Invalid report type'),

    query('status')
        .optional()
        .isIn(['processing', 'completed', 'failed'])
        .withMessage('Invalid status'),

    query('date_from')
        .optional()
        .isISO8601()
        .withMessage('date_from must be in YYYY-MM-DD format'),

    query('date_to')
        .optional()
        .isISO8601()
        .withMessage('date_to must be in YYYY-MM-DD format'),

    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),

    query('page_size')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Page size must be between 1 and 100'),

    query('sort_by')
        .optional()
        .isIn(['created_at', 'updated_at', 'title', 'status', 'generated_at'])
        .withMessage('Invalid sort_by field'),

    query('sort_order')
        .optional()
        .isIn(['asc', 'desc'])
        .withMessage('Sort order must be asc or desc')
];

/**
 * Validation for GET /api/reports/:id
 */
const getReportByIdValidation = [
    param('id')
        .notEmpty()
        .withMessage('Report ID is required')
];

/**
 * Validation for POST /api/reports (create report)
 */
const createReportValidation = [
    body('report_type')
        .notEmpty()
        .withMessage('Report type is required')
        .isIn(['carbon_audit', 'compliance', 'export_declaration', 'sustainability', 'manual', 'export_data'])
        .withMessage('Invalid report type'),

    body('title')
        .trim()
        .notEmpty()
        .withMessage('Title is required')
        .isLength({ min: 3, max: 200 })
        .withMessage('Title must be between 3 and 200 characters'),

    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Description must not exceed 1000 characters'),

    body('period_start')
        .optional()
        .isISO8601()
        .withMessage('period_start must be in YYYY-MM-DD format'),

    body('period_end')
        .optional()
        .isISO8601()
        .withMessage('period_end must be in YYYY-MM-DD format')
        .custom((value, { req }) => {
            if (req.body.period_start && value) {
                const start = new Date(req.body.period_start);
                const end = new Date(value);
                if (end < start) {
                    throw new Error('period_end must be after period_start');
                }
            }
            return true;
        }),

    body('target_market')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Target market must not exceed 100 characters'),

    body('file_format')
        .optional()
        .isIn(['pdf', 'xlsx', 'csv'])
        .withMessage('File format must be pdf, xlsx, or csv'),

    body('filters')
        .optional()
        .isObject()
        .withMessage('Filters must be an object'),

    body('filters.product_ids')
        .optional()
        .isArray()
        .withMessage('product_ids must be an array'),

    body('filters.product_ids.*')
        .optional()
        .isString()
        .withMessage('Each product_id must be a string'),

    body('filters.include_shipments')
        .optional()
        .isBoolean()
        .withMessage('include_shipments must be a boolean')
];

/**
 * Validation for PATCH /api/reports/:id/status
 */
const updateReportStatusValidation = [
    param('id')
        .notEmpty()
        .withMessage('Report ID is required'),

    body('status')
        .notEmpty()
        .withMessage('Status is required')
        .isIn(['processing', 'completed', 'failed'])
        .withMessage('Invalid status value. Must be: processing, completed, or failed')
];

/**
 * Validation for POST /api/reports/exports (unified export pipeline)
 */
const createDatasetExportValidation = [
    body('dataset_type')
        .notEmpty()
        .withMessage('dataset_type is required')
        .isIn(['product', 'activity', 'audit', 'users', 'history', 'analytics', 'company'])
        .withMessage('Invalid dataset_type. Must be: product, activity, audit, users, history, analytics, or company'),

    body('file_format')
        .optional()
        .isIn(['csv', 'xlsx'])
        .withMessage('File format must be csv or xlsx'),

    body('title')
        .optional()
        .trim()
        .isLength({ min: 3, max: 200 })
        .withMessage('Title must be between 3 and 200 characters')
];

module.exports = {
    listReportsValidation,
    getReportByIdValidation,
    createReportValidation,
    updateReportStatusValidation,
    createDatasetExportValidation
};
