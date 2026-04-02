const express = require('express');
const validate = require('../middleware/validator');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/http');
const b2cCollectionPointsService = require('../services/b2cCollectionPointsService');
const { listNearbyCollectionPointsValidation } = require('../validators/b2cValidators');

const router = express.Router();

router.use(authenticate, requireRole('b2c'));

router.get(
  '/collection-points/nearby',
  listNearbyCollectionPointsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cCollectionPointsService.listNearbyCollectionPoints({
      latitude: req.query.lat,
      longitude: req.query.lng,
      limit: req.query.limit || 6
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

module.exports = router;
