const { validationResult } = require('express-validator');
const { sendError } = require('../utils/http');

function mapValidationErrors(errors) {
  return errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value
  }));
}

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return sendError(res, {
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: mapValidationErrors(errors)
    });
  }

  next();
};

module.exports = validate;
