/**
 * Batch Validators
 * Validation rules for product batches endpoints
 */

const { body, param, query } = require('express-validator');

// List batches
const listBatchesValidation = [
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search must be less than 100 characters'),
  
  query('status')
    .optional()
    .isIn(['draft', 'active', 'archived', 'all'])
    .withMessage('Status must be draft, active, archived, or all'),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be positive integer'),
  
  query('page_size')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Page size must be between 1 and 100')
];

// Get batch by ID
const getBatchByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
];

// Create batch
const createBatchValidation = [
  body('name')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Batch name is required')
    .isLength({ max: 255 })
    .withMessage('Batch name must be less than 255 characters'),
  
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  
  body('originAddress')
    .optional()
    .isObject()
    .withMessage('Origin address must be an object'),
  
  body('destinationAddress')
    .optional()
    .isObject()
    .withMessage('Destination address must be an object'),
  
  body('destinationMarket')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Destination market must be less than 50 characters'),
  
  body('transportModes')
    .optional()
    .isArray()
    .withMessage('Transport modes must be an array'),
  
  body('transportModes.*')
    .optional()
    .isIn(['sea', 'air', 'road', 'rail'])
    .withMessage('Transport mode must be sea, air, road, or rail')
];

// Update batch
const updateBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required'),
  
  body('name')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Batch name cannot be empty')
    .isLength({ max: 255 })
    .withMessage('Batch name must be less than 255 characters'),
  
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  
  body('originAddress')
    .optional()
    .isObject()
    .withMessage('Origin address must be an object'),
  
  body('destinationAddress')
    .optional()
    .isObject()
    .withMessage('Destination address must be an object'),
  
  body('destinationMarket')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Destination market must be less than 50 characters'),
  
  body('transportModes')
    .optional()
    .isArray()
    .withMessage('Transport modes must be an array'),
  
  body('transportModes.*')
    .optional()
    .isIn(['sea', 'air', 'road', 'rail'])
    .withMessage('Transport mode must be sea, air, road, or rail')
];

// Delete batch
const deleteBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
];

// Add item to batch
const addBatchItemValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required'),
  
  body('product_id')
    .notEmpty()
    .withMessage('Product ID is required'),
  
  body('quantity')
    .isFloat({ min: 0.01 })
    .withMessage('Quantity must be greater than 0'),
  
  body('weight_kg')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be non-negative'),
  
  body('co2_per_unit')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('CO2 per unit must be non-negative')
];

// Update batch item
const updateBatchItemValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required'),
  
  param('product_id')
    .notEmpty()
    .withMessage('Product ID is required'),
  
  body('quantity')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Quantity must be greater than 0'),
  
  body('weight_kg')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be non-negative'),
  
  body('co2_per_unit')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('CO2 per unit must be non-negative')
];

// Delete batch item
const deleteBatchItemValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required'),
  
  param('product_id')
    .notEmpty()
    .withMessage('Product ID is required')
];

// Publish batch
const publishBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
];

module.exports = {
  listBatchesValidation,
  getBatchByIdValidation,
  createBatchValidation,
  updateBatchValidation,
  deleteBatchValidation,
  addBatchItemValidation,
  updateBatchItemValidation,
  deleteBatchItemValidation,
  publishBatchValidation
};
