const express = require('express');
const { authenticate, requireRole } = require('../shared/security');
const { asyncHandler, parsePositiveInt, sendError, sendSuccess } = require('../shared/http');
const { carbonService } = require('./service');
const { ensureCompanyId, handleValidationError } = require('./http');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  const result = await carbonService.listFuelInvoices({
    companyId,
    page: parsePositiveInt(req.query.page, 1),
    limit: Math.min(parsePositiveInt(req.query.limit, 100), 500)
  });
  return sendSuccess(res, result);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  try {
    const invoice = await carbonService.createFuelInvoice({
      companyId,
      userId: req.userId,
      payload: req.body
    });
    return sendSuccess(res, { status: 201, data: invoice });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  const invoice = await carbonService.updateFuelInvoice({
    id: req.params.id,
    companyId,
    changes: req.body
  });
  if (!invoice) {
    return sendError(res, {
      status: 404,
      code: 'NOT_FOUND',
      message: 'Fuel invoice not found.'
    });
  }
  return sendSuccess(res, { data: invoice });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  const deleted = await carbonService.deleteFuelInvoice({ id: req.params.id, companyId });
  if (!deleted) {
    return sendError(res, {
      status: 404,
      code: 'NOT_FOUND',
      message: 'Fuel invoice not found.'
    });
  }
  return sendSuccess(res, { data: { deleted: true } });
}));

module.exports = router;
