const { body } = require('express-validator');
const { SUPPORTED_TARGET_MARKETS_SET } = require('../shared/targetMarkets');
const { normalizeDomesticMarket } = require('../shared/companyMarkets');

const signupValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),

  body('full_name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),

  body('role')
    .isIn(['b2b', 'b2c'])
    .withMessage('Role must be either b2b or b2c'),

  body('company_name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Company name cannot be empty'),

  body('business_type')
    .optional()
    .isIn(['shop_online', 'brand', 'factory'])
    .withMessage('Invalid business type'),

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
    .customSanitizer((value, { req }) => normalizeDomesticMarket(value, req.body.target_markets)),

  body('phone')
    .optional()
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Invalid phone number format')
];

const signinValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),

  body('remember_me')
    .optional()
    .isBoolean()
    .withMessage('Remember me must be a boolean'),

  body('totp_code')
    .optional()
    .trim()
    .matches(/^(?:\d{6}|[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3})$/i)
    .withMessage('MFA code must be a 6-digit authenticator code or recovery code')
];

const refreshValidation = [
  body('refresh_token')
    .optional()
    .isString()
    .notEmpty()
    .withMessage('Refresh token must be a non-empty string')
];

const verifyEmailValidation = [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required'),

  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
];

const demoValidation = [
  body('role')
    .isIn(['b2b', 'b2c'])
    .withMessage('Role must be either b2b or b2c'),

  body('demo_scenario')
    .optional()
    .isIn(['empty', 'sample_data', 'full'])
    .withMessage('Invalid demo scenario')
];

const mfaCode = /^(?:\d{6}|[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3})$/i;

const mfaEnrollmentValidation = [
  body('password').isString().notEmpty().withMessage('Current password is required'),
  body('current_code')
    .optional()
    .trim()
    .matches(mfaCode)
    .withMessage('Current MFA code must be an authenticator or recovery code')
];

const mfaConfirmationValidation = [
  body('totp_code')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('A 6-digit authenticator code is required')
];

const mfaDisableValidation = [
  body('password').isString().notEmpty().withMessage('Current password is required'),
  body('mfa_code')
    .trim()
    .matches(mfaCode)
    .withMessage('A valid authenticator or recovery code is required'),
  body('reason')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('A disable reason between 1 and 1000 characters is required')
];

module.exports = {
  signupValidation,
  signinValidation,
  refreshValidation,
  verifyEmailValidation,
  demoValidation,
  mfaEnrollmentValidation,
  mfaConfirmationValidation,
  mfaDisableValidation
};


