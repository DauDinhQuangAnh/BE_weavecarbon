const express = require('express');
const { authenticate, requireRole } = require('../shared/security');
const { asyncHandler, parsePositiveInt, sendSuccess } = require('../shared/http');
const { carbonService } = require('./service');
const { ensureCompanyId, handleValidationError } = require('./http');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  const result = await carbonService.listCalculations({
    companyId,
    productId: req.query.product_id,
    calculationType: req.query.calculation_type,
    page: parsePositiveInt(req.query.page, 1),
    limit: Math.min(parsePositiveInt(req.query.limit, 100), 500)
  });
  return sendSuccess(res, result);
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) return;

  try {
    const calculation = await carbonService.createCalculation({
      companyId,
      userId: req.userId,
      payload: req.body
    });
    return sendSuccess(res, { status: 201, data: calculation });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

module.exports = router;
