const { body, param, query } = require('express-validator');

/**
 * Validation rules for Logistics APIs
 */

// List shipments validation
const listShipmentsValidation = [
  query('search')
    .optional()
    .isString()
    .trim(),
  query('status')
    .optional()
    .isIn(['pending', 'in_transit', 'delivered', 'cancelled', 'all'])
    .withMessage('Status must be: pending, in_transit, delivered, cancelled, or all'),
  query('transport_mode')
    .optional()
    .isIn(['road', 'sea', 'air', 'rail'])
    .withMessage('Transport mode must be: road, sea, air, or rail'),
  query('date_from')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('date_from must be in YYYY-MM-DD format'),
  query('date_to')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
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
    .isIn(['created_at', 'updated_at', 'estimated_arrival', 'total_co2e'])
    .withMessage('sort_by must be: created_at, updated_at, estimated_arrival, or total_co2e'),
  query('sort_order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sort_order must be: asc or desc')
];

// Get shipment by ID validation
const getShipmentByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Shipment ID is required')
];

// Location validation schema (reusable)
const locationValidation = (fieldPrefix) => [
  body(`${fieldPrefix}.country`)
    .notEmpty()
    .withMessage(`${fieldPrefix}.country is required`)
    .isString()
    .trim(),
  body(`${fieldPrefix}.city`)
    .notEmpty()
    .withMessage(`${fieldPrefix}.city is required`)
    .isString()
    .trim(),
  body(`${fieldPrefix}.address`)
    .optional()
    .isString()
    .trim(),
  body(`${fieldPrefix}.lat`)
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage(`${fieldPrefix}.lat must be between -90 and 90`),
  body(`${fieldPrefix}.lng`)
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage(`${fieldPrefix}.lng must be between -180 and 180`)
];

// Leg validation schema (reusable)
const legValidation = [
  body('legs')
    .isArray({ min: 1 })
    .withMessage('At least one leg is required'),
  body('legs.*.leg_order')
    .isInt({ min: 1 })
    .withMessage('leg_order must be a positive integer'),
  body('legs.*.transport_mode')
    .isIn(['road', 'sea', 'air', 'rail'])
    .withMessage('transport_mode must be: road, sea, air, or rail'),
  body('legs.*.origin_location')
    .notEmpty()
    .withMessage('origin_location is required')
    .isString()
    .trim(),
  body('legs.*.destination_location')
    .notEmpty()
    .withMessage('destination_location is required')
    .isString()
    .trim(),
  body('legs.*.distance_km')
    .isFloat({ min: 0 })
    .withMessage('distance_km must be >= 0'),
  body('legs.*.duration_hours')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('duration_hours must be >= 0'),
  body('legs.*.co2e')
    .isFloat({ min: 0 })
    .withMessage('co2e must be >= 0'),
  body('legs.*.emission_factor_used')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('emission_factor_used must be >= 0'),
  body('legs.*.carrier_name')
    .optional()
    .isString()
    .trim(),
  body('legs.*.vehicle_type')
    .optional()
    .isString()
    .trim()
];

// Product validation schema (reusable)
const productValidation = [
  body('products')
    .isArray({ min: 1 })
    .withMessage('At least one product is required'),
  body('products.*.product_id')
    .notEmpty()
    .withMessage('product_id is required'),
  body('products.*.quantity')
    .isInt({ min: 1 })
    .withMessage('quantity must be > 0'),
  body('products.*.weight_kg')
    .isFloat({ min: 0 })
    .withMessage('weight_kg must be >= 0'),
  body('products.*.allocated_co2e')
    .isFloat({ min: 0 })
    .withMessage('allocated_co2e must be >= 0')
];

// Create shipment validation
const createShipmentValidation = [
  body('reference_number')
    .optional()
    .isString()
    .trim(),
  ...locationValidation('origin'),
  ...locationValidation('destination'),
  body('estimated_arrival')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('estimated_arrival must be in YYYY-MM-DD format'),
  ...legValidation,
  ...productValidation
];

// Update shipment validation
const updateShipmentValidation = [
  param('id')
    .notEmpty()
    .withMessage('Shipment ID is required'),
  body('reference_number')
    .optional()
    .isString()
    .trim(),
  body('origin')
    .optional()
    .isObject(),
  body('origin.country')
    .optional()
    .isString()
    .trim(),
  body('origin.city')
    .optional()
    .isString()
    .trim(),
  body('origin.address')
    .optional()
    .isString()
    .trim(),
  body('origin.lat')
    .optional()
    .isFloat({ min: -90, max: 90 }),
  body('origin.lng')
    .optional()
    .isFloat({ min: -180, max: 180 }),
  body('destination')
    .optional()
    .isObject(),
  body('destination.country')
    .optional()
    .isString()
    .trim(),
  body('destination.city')
    .optional()
    .isString()
    .trim(),
  body('destination.address')
    .optional()
    .isString()
    .trim(),
  body('destination.lat')
    .optional()
    .isFloat({ min: -90, max: 90 }),
  body('destination.lng')
    .optional()
    .isFloat({ min: -180, max: 180 }),
  body('estimated_arrival')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('estimated_arrival must be in YYYY-MM-DD format')
];

// Update shipment status validation
const updateShipmentStatusValidation = [
  param('id')
    .notEmpty()
    .withMessage('Shipment ID is required'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'in_transit', 'delivered', 'cancelled'])
    .withMessage('Status must be: pending, in_transit, delivered, or cancelled'),
  body('actual_arrival')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('actual_arrival must be in YYYY-MM-DD format')
];

// Update shipment legs validation
const updateShipmentLegsValidation = [
  param('id')
    .notEmpty()
    .withMessage('Shipment ID is required'),
  ...legValidation
];

// Update shipment products validation
const updateShipmentProductsValidation = [
  param('id')
    .notEmpty()
    .withMessage('Shipment ID is required'),
  ...productValidation
];

module.exports = {
  listShipmentsValidation,
  getShipmentByIdValidation,
  createShipmentValidation,
  updateShipmentValidation,
  updateShipmentStatusValidation,
  updateShipmentLegsValidation,
  updateShipmentProductsValidation
};
