const { body, param, query } = require('express-validator');

const createMemberValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('full_name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('role').isIn(['member', 'viewer']).withMessage('Role must be either member or viewer'),
  body('send_notification_email')
    .optional()
    .isBoolean()
    .withMessage('send_notification_email must be a boolean'),
  body('frontend_origin')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('frontend_origin must be a non-empty string')
];

const updateMemberValidation = [
  param('id').notEmpty().withMessage('Member ID is required'),
  body('role')
    .optional()
    .isIn(['member', 'viewer'])
    .withMessage('Role must be either member or viewer'),
  body('status')
    .optional()
    .isIn(['active', 'disabled'])
    .withMessage('Status must be either active or disabled')
];

const deleteMemberValidation = [param('id').notEmpty().withMessage('Member ID is required')];
const resendInviteValidation = [
  param('id').notEmpty().withMessage('Member ID is required'),
  body('frontend_origin')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('frontend_origin must be a non-empty string')
];
const getMembersValidation = [
  query('status')
    .optional()
    .isIn(['active', 'invited', 'disabled'])
    .withMessage('Invalid status filter'),
  query('role')
    .optional()
    .isIn(['admin', 'member', 'viewer'])
    .withMessage('Invalid role filter')
];

module.exports = {
  createMemberValidation,
  updateMemberValidation,
  deleteMemberValidation,
  getMembersValidation,
  resendInviteValidation
};
