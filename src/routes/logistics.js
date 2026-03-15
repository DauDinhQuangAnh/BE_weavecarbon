const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validator');
const logisticsService = require('../services/logisticsService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePositiveInt, sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const {
  listShipmentsValidation,
  getShipmentByIdValidation,
  createShipmentValidation,
  updateShipmentValidation,
  updateShipmentStatusValidation,
  updateShipmentLegsValidation,
  updateShipmentProductsValidation
} = require('../validators/logisticsValidators');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function ensureCompanyId(req, res) {
  if (req.companyId) {
    return req.companyId;
  }

  sendNoCompany(res, 'User is not associated with any company');
  return null;
}

function handleLogisticsError(res, error) {
  if (error.code === 'SHIPMENT_STATUS_AUTO_MANAGED') {
    sendError(res, {
      status: error.statusCode || 400,
      code: error.code,
      message: error.message
    });
    return true;
  }

  if (error.code === 'SHIPMENT_CANCELLATION_NOT_ALLOWED') {
    sendError(res, {
      status: error.statusCode || 409,
      code: error.code,
      message: error.message
    });
    return true;
  }

  const mappedError = {
    PRODUCT_NOT_IN_COMPANY: {
      status: 400,
      code: 'PRODUCT_NOT_IN_COMPANY',
      message: 'One or more products do not belong to your company'
    },
    INVALID_SHIPMENT_STATUS_TRANSITION: {
      status: 400,
      code: 'INVALID_SHIPMENT_STATUS_TRANSITION',
      message: 'Invalid status transition'
    },
    SHIPMENT_NOT_FOUND: {
      status: 404,
      code: 'SHIPMENT_NOT_FOUND',
      message: 'Shipment not found'
    },
    INVALID_SHIPMENT_PAYLOAD: {
      status: 400,
      code: 'INVALID_SHIPMENT_PAYLOAD',
      message: 'Leg orders must be unique and sequential starting from 1'
    }
  }[error.message];

  if (!mappedError) {
    return false;
  }

  sendError(res, mappedError);
  return true;
}

router.get('/shipments', listShipmentsValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await logisticsService.listShipments(companyId, {
    search: req.query.search,
    status: req.query.status,
    transport_mode: req.query.transport_mode,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
    page: parsePositiveInt(req.query.page, 1),
    page_size: parsePositiveInt(req.query.page_size, 20),
    sort_by: req.query.sort_by || 'updated_at',
    sort_order: req.query.sort_order || 'desc'
  });

  return sendSuccess(res, {
    data: result
  });
}));

router.get('/overview', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const overview = await logisticsService.getLogisticsOverview(companyId);

  return sendSuccess(res, {
    data: overview
  });
}));

router.get('/shipments/:id', getShipmentByIdValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const shipment = await logisticsService.getShipmentById(req.params.id, companyId);
  if (!shipment) {
    return sendError(res, {
      status: 404,
      code: 'SHIPMENT_NOT_FOUND',
      message: 'Shipment not found'
    });
  }

  return sendSuccess(res, {
    data: shipment
  });
}));

router.post('/shipments', createShipmentValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  if (!Array.isArray(req.body.products) || req.body.products.length === 0) {
    return sendError(res, {
      status: 400,
      code: 'EMPTY_SHIPMENT_PRODUCTS',
      message: 'At least one product is required'
    });
  }

  try {
    const result = await logisticsService.createShipment(companyId, req.userId, req.body);

    return sendSuccess(res, {
      status: 201,
      data: result
    });
  } catch (error) {
    if (handleLogisticsError(res, error)) {
      return;
    }

    throw error;
  }
}));

router.patch('/shipments/:id', updateShipmentValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await logisticsService.updateShipment(req.params.id, companyId, req.body);
  if (!result) {
    return sendError(res, {
      status: 404,
      code: 'SHIPMENT_NOT_FOUND',
      message: 'Shipment not found'
    });
  }

  return sendSuccess(res, {
    data: result
  });
}));

router.patch(
  '/shipments/:id/status',
  updateShipmentStatusValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await logisticsService.updateShipmentStatus(
        req.params.id,
        companyId,
        req.body.status,
        req.body.actual_arrival
      );

      if (!result) {
        return sendError(res, {
          status: 404,
          code: 'SHIPMENT_NOT_FOUND',
          message: 'Shipment not found'
        });
      }

      return sendSuccess(res, {
        data: result
      });
    } catch (error) {
      if (handleLogisticsError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

router.put(
  '/shipments/:id/legs',
  updateShipmentLegsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await logisticsService.replaceShipmentLegs(
        req.params.id,
        companyId,
        req.body.legs
      );

      return sendSuccess(res, {
        data: result
      });
    } catch (error) {
      if (handleLogisticsError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

router.put(
  '/shipments/:id/products',
  updateShipmentProductsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await logisticsService.replaceShipmentProducts(
        req.params.id,
        companyId,
        req.body.products
      );

      return sendSuccess(res, {
        data: result
      });
    } catch (error) {
      if (handleLogisticsError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

module.exports = router;
