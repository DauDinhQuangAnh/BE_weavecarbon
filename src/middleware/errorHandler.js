const { sendError } = require('../utils/http');

function applyDatabaseError(error) {
  if (error.code === '23505') {
    error.statusCode = 409;
    error.code = 'DUPLICATE_ENTRY';
    error.message = 'Resource already exists';
  } else if (error.code === '23503') {
    error.statusCode = 400;
    error.code = 'INVALID_REFERENCE';
    error.message = 'Referenced resource does not exist';
  } else if (error.code === '23502') {
    error.statusCode = 400;
    error.code = 'MISSING_REQUIRED_FIELD';
    error.message = 'Required field is missing';
  }
}

function applyJwtError(error) {
  if (error.name === 'JsonWebTokenError') {
    error.statusCode = 401;
    error.code = 'INVALID_TOKEN';
    error.message = 'Invalid token';
  } else if (error.name === 'TokenExpiredError') {
    error.statusCode = 401;
    error.code = 'TOKEN_EXPIRED';
    error.message = 'Token has expired';
  }
}

function applyValidationError(error) {
  if (error.name === 'ValidationError') {
    error.statusCode = 422;
    error.code = 'VALIDATION_ERROR';
  }
}

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  applyDatabaseError(err);
  applyJwtError(err);
  applyValidationError(err);

  return sendError(res, {
    status: err.statusCode || 500,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
    details: err.details
  });
};

const notFound = (req, res) => sendError(res, {
  status: 404,
  code: 'NOT_FOUND',
  message: `Route ${req.originalUrl} not found`
});

module.exports = {
  errorHandler,
  notFound
};
