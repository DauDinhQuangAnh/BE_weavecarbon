const { body } = require('express-validator');
const {
    SUPPORTED_TARGET_MARKETS_SET,
    normalizeTargetMarkets
} = require('../constants/targetMarkets');
const { normalizeDomesticMarket } = require('../utils/companyMarkets');

const createCompanyValidation = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Company name is required')
        .isLength({ min: 2, max: 200 })
        .withMessage('Company name must be between 2 and 200 characters'),

    body('business_type')
        .notEmpty()
        .withMessage('Business type is required')
        .isIn(['shop_online', 'brand', 'factory'])
        .withMessage('Invalid business type. Must be shop_online, brand, or factory'),

    body('target_markets')
        .optional()
        .isArray()
        .withMessage('Target markets must be an array'),

    body('target_markets.*')
        .optional()
        .custom((value) => {
            const normalizedCode = String(value || '').trim().toUpperCase();
            return SUPPORTED_TARGET_MARKETS_SET.has(normalizedCode);
        })
        .withMessage('Invalid target market code'),

    body('target_markets')
        .optional()
        .customSanitizer((value) => normalizeTargetMarkets(value))
    ,

    body('domestic_market')
        .optional()
        .custom((value) => {
            if (value === null || value === undefined || value === '') return true;
            const normalizedCode = String(value || '').trim().toUpperCase();
            return SUPPORTED_TARGET_MARKETS_SET.has(normalizedCode);
        })
        .withMessage('Invalid domestic market code'),

    body('domestic_market')
        .optional()
        .customSanitizer((value, { req }) => normalizeDomesticMarket(value, req.body.target_markets))
];

const updateProfileValidation = [
    body('full_name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Full name must be between 2 and 100 characters'),

    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email is required')
];

const updateCompanyValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 200 })
        .withMessage('Company name must be between 2 and 200 characters'),

    body('business_type')
        .isIn(['shop_online', 'brand', 'factory'])
        .withMessage('Invalid business type. Must be shop_online, brand, or factory'),

    body('target_markets')
        .optional()
        .isArray()
        .withMessage('Target markets must be an array'),

    body('target_markets.*')
        .optional()
        .custom((value) => {
            const normalizedCode = String(value || '').trim().toUpperCase();
            return SUPPORTED_TARGET_MARKETS_SET.has(normalizedCode);
        })
        .withMessage('Invalid target market code'),

    body('target_markets')
        .optional()
        .customSanitizer((value) => normalizeTargetMarkets(value))
    ,

    body('domestic_market')
        .optional()
        .custom((value) => {
            if (value === null || value === undefined || value === '') return true;
            const normalizedCode = String(value || '').trim().toUpperCase();
            return SUPPORTED_TARGET_MARKETS_SET.has(normalizedCode);
        })
        .withMessage('Invalid domestic market code'),

    body('domestic_market')
        .optional()
        .customSanitizer((value, { req }) => normalizeDomesticMarket(value, req.body.target_markets))
];

const changePasswordValidation = [
    body('new_password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must contain uppercase, lowercase, number, and special character'),

    body('confirm_password')
        .custom((value, { req }) => value === req.body.new_password)
        .withMessage('Passwords do not match')
];

module.exports = {
    createCompanyValidation,
    updateProfileValidation,
    updateCompanyValidation,
    changePasswordValidation
};
