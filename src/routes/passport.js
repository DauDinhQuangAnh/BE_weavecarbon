const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const passportService = require('../services/passportService');

const router = express.Router();

router.get(
  '/:productId',
  asyncHandler(async (req, res) => {
    const payload = await passportService.getPublicPassportPayload(req.params.productId);

    if (!payload) {
      return sendError(res, {
        status: 404,
        code: 'PASSPORT_PRODUCT_NOT_FOUND',
        message: 'Passport product not found'
      });
    }

    return sendSuccess(res, {
      data: payload
    });
  })
);

module.exports = router;
