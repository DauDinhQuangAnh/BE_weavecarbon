const { body, param } = require('express-validator');

/**
 * Validation for POST /export/markets/:market_code/recommendations/:recommendation_id/actions
 */
const recommendationActionValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    param('recommendation_id')
        .notEmpty()
        .withMessage('Recommendation ID is required'),

    body('action')
        .notEmpty()
        .withMessage('Action is required')
        .isIn(['start', 'complete', 'dismiss', 'reset', 'mark_completed'])
        .withMessage('Invalid action. Must be: start, complete, dismiss, reset, or mark_completed')
];

/**
 * Validation for POST /export/markets/:market_code/products
 */
const addProductToScopeValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    body('product_id')
        .notEmpty()
        .withMessage('product_id is required'),

    body('hs_code')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('HS code must not exceed 50 characters'),

    body('notes')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Notes must not exceed 500 characters')
];

/**
 * Validation for PATCH /export/markets/:market_code/products/:product_id
 */
const updateProductInScopeValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    param('product_id')
        .notEmpty()
        .withMessage('Product ID is required'),

    body('hs_code')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('HS code must not exceed 50 characters'),

    body('notes')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Notes must not exceed 500 characters')
];

/**
 * Validation for DELETE /export/markets/:market_code/products/:product_id
 */
const removeProductFromScopeValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    param('product_id')
        .notEmpty()
        .withMessage('Product ID is required')
];

/**
 * Validation for PATCH /export/markets/:market_code/carbon-data/:scope
 */
const updateCarbonDataValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    param('scope')
        .notEmpty()
        .trim()
        .isIn(['scope1', 'scope2', 'scope3'])
        .withMessage('Invalid scope. Must be: scope1, scope2, or scope3'),

    body('value')
        .notEmpty()
        .withMessage('Value is required')
        .isNumeric()
        .withMessage('Value must be a number'),

    body('unit')
        .optional()
        .trim()
        .isLength({ max: 20 })
        .withMessage('Unit must not exceed 20 characters'),

    body('methodology')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Methodology must not exceed 500 characters'),

    body('data_source')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Data source must not exceed 200 characters'),

    body('reporting_period')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Reporting period must not exceed 100 characters')
];

/**
 * Validation for document operations
 */
const documentParamsValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    param('document_id')
        .notEmpty()
        .withMessage('Document ID is required')
];

/**
 * Validation for POST /export/markets/:market_code/documents/:document_id/approve
 */
const approveDocumentValidation = [...documentParamsValidation];

/**
 * Validation for POST /export/markets/:market_code/documents/import
 */
const importDocumentsValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    body('rows')
        .isArray({ min: 1 })
        .withMessage('rows must be a non-empty array')
];

/**
 * Validation for POST /export/markets/:market_code/reports
 */
const generateComplianceReportValidation = [
    param('market_code')
        .notEmpty()
        .trim()
        .withMessage('Market code is required'),

    body('file_format')
        .notEmpty()
        .withMessage('file_format is required')
        .isIn(['xlsx', 'csv', 'pdf'])
        .withMessage('File format must be xlsx, csv, or pdf')
];

module.exports = {
    recommendationActionValidation,
    addProductToScopeValidation,
    updateProductInScopeValidation,
    removeProductFromScopeValidation,
    updateCarbonDataValidation,
    documentParamsValidation,
    approveDocumentValidation,
    importDocumentsValidation,
    generateComplianceReportValidation
};
