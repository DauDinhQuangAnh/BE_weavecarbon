class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;

    if (typeof details !== 'undefined') {
      this.details = details;
    }
  }
}

function createAppError(message, options) {
  return new AppError(message, options);
}

module.exports = {
  AppError,
  createAppError
};
