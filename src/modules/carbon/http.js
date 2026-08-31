const { sendError, sendNoCompany } = require('../shared/http');

function ensureCompanyId(req, res) {
  if (req.companyId) return req.companyId;
  sendNoCompany(res);
  return null;
}

function handleValidationError(res, error) {
  if (error?.code !== 'VALIDATION_ERROR') return false;
  sendError(res, {
    status: error.statusCode || 400,
    code: error.code,
    message: error.message
  });
  return true;
}

module.exports = { ensureCompanyId, handleValidationError };
