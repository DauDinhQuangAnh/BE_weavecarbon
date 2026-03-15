const { body, query, param } = require('express-validator');

/**
 * Validation for GET /api/products (list products)
 */
const listProductsValidation = [
    query('search')
        .optional()
        .isString()
        .trim()
        .withMessage('Search must be a string'),

    query('status')
        .optional()
        .isIn(['draft', 'published', 'active', 'archived', 'all'])
        .withMessage('Status must be draft, published, active, archived, or all'),

    query('category')
        .optional()
        .isString()
        .trim()
        .withMessage('Category must be a string'),

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
        .isIn(['created_at', 'updated_at', 'name', 'sku', 'total_co2e'])
        .withMessage('Invalid sort_by field'),

    query('sort_order')
        .optional()
        .isIn(['asc', 'desc'])
        .withMessage('Sort order must be asc or desc'),

    query('include')
        .optional()
        .isString()
        .withMessage('Include must be a comma-separated string')
];

/**
 * Validation for GET /api/products/:id
 */
const getProductByIdValidation = [
    param('id')
        .notEmpty()
        .withMessage('Product ID is required')
];

/**
 * Validation for POST /api/products (create product)
 */
const createProductValidation = [
    body('productCode')
        .trim()
        .notEmpty()
        .withMessage('Product code is required')
        .isLength({ min: 1, max: 100 })
        .withMessage('Product code must be between 1 and 100 characters'),

    body('productName')
        .trim()
        .notEmpty()
        .withMessage('Product name is required')
        .isLength({ min: 1, max: 200 })
        .withMessage('Product name must be between 1 and 200 characters'),

    body('productType')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Product type must not exceed 100 characters'),

    body('weightPerUnit')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Weight per unit must be a positive number'),

    body('quantity')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Quantity must be a non-negative integer'),

    body('materials')
        .optional()
        .isArray()
        .withMessage('Materials must be an array'),

    body('accessories')
        .optional()
        .isArray()
        .withMessage('Accessories must be an array'),

    body('productionProcesses')
        .optional()
        .isArray()
        .withMessage('Production processes must be an array'),

    body('energySources')
        .optional()
        .isArray()
        .withMessage('Energy sources must be an array'),

    body('carbonResults')
        .optional()
        .isObject()
        .withMessage('Carbon results must be an object'),

    body('save_mode')
        .optional()
        .isIn(['draft', 'publish'])
        .withMessage('Save mode must be draft or publish')
];

/**
 * Validation for PUT /api/products/:id (update product)
 */
const updateProductValidation = [
    param('id')
        .notEmpty()
        .withMessage('Product ID is required'),

    ...createProductValidation.slice(0, -1) // Reuse create validation except save_mode
];

/**
 * Validation for PATCH /api/products/:id/status
 */
const updateProductStatusValidation = [
    param('id')
        .notEmpty()
        .withMessage('Product ID is required'),

    body('status')
        .notEmpty()
        .withMessage('Status is required')
        .isIn(['draft', 'published', 'active', 'archived'])
        .withMessage('Status must be draft, published, active, or archived')
];

/**
 * Validation for DELETE /api/products/:id
 */
const deleteProductValidation = [
    param('id')
        .notEmpty()
        .withMessage('Product ID is required')
];

/**
 * Validation for POST /api/products/bulk-import
 */
const bulkImportValidation = [
    body('rows')
        .isArray({ min: 1 })
        .withMessage('Rows must be a non-empty array'),

    body('rows.*.sku')
        .trim()
        .notEmpty()
        .withMessage('SKU is required for each row'),

    body('rows.*.productName')
        .trim()
        .notEmpty()
        .withMessage('Product name is required for each row'),

    body('save_mode')
        .optional()
        .isIn(['draft', 'publish'])
        .withMessage('Save mode must be draft or publish')
];

/**
 * Validation for POST /api/products/bulk-import/validate
 */
const bulkImportValidateValidation = [
    body('rows')
        .optional()
        .isArray()
        .withMessage('Rows must be an array')
];

/**
 * Validation for GET /api/products/bulk-template
 */
const bulkTemplateValidation = [
    query('format')
        .optional()
        .isIn(['xlsx', 'csv'])
        .withMessage('Format must be xlsx or csv')
];

module.exports = {
    listProductsValidation,
    getProductByIdValidation,
    createProductValidation,
    updateProductValidation,
    updateProductStatusValidation,
    deleteProductValidation,
    bulkImportValidation,
    bulkImportValidateValidation,
    bulkTemplateValidation
};
