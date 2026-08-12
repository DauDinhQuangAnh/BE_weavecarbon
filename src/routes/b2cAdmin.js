const express = require('express');
const validate = require('../middleware/validator');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const b2cService = require('../services/b2cService');
const { recordDispositionValidation } = require('../validators/b2cValidators');

const router = express.Router();

const handleB2CError = (res, error) => {
  if (!error || typeof error !== 'object' || !error.code) {
    return false;
  }

  sendError(res, {
    status: error.statusCode || 400,
    code: error.code,
    message: error.message || 'B2C admin request failed',
    details: error.details
  });
  return true;
};

// Sorting-centre operations, restricted to operators/admins. Kept on a separate
// router because the consumer `/api/b2c` router is gated to the `b2c` role.
router.use(authenticate, requireRole('admin'));

router.post(
  '/donations/:donationId/disposition',
  recordDispositionValidation,
  validate,
  asyncHandler(async (req, res) => {
    try {
      const payload = await b2cService.recordDonationDisposition(
        req.params.donationId,
        req.body.disposition,
        req.body.note
      );

      return sendSuccess(res, { data: payload });
    } catch (error) {
      if (handleB2CError(res, error)) {
        return undefined;
      }
      throw error;
    }
  })
);

module.exports = router;
