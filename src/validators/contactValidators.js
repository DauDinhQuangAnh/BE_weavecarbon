const { body } = require('express-validator');

const contactLeadValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required')
];

module.exports = {
  contactLeadValidation
};
