const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validator');
const productsService = require('../services/productsService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePositiveInt, sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const {
  listProductsValidation,
  getProductByIdValidation,
  createProductValidation,
  updateProductValidation,
  updateProductStatusValidation,
  deleteProductValidation,
  bulkImportValidation,
  bulkImportValidateValidation,
  bulkTemplateValidation
} = require('../validators/productsValidators');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function ensureCompanyId(req, res) {
  if (req.companyId) {
    return req.companyId;
  }

  sendNoCompany(res, 'No company associated with this user');
  return null;
}

function handleProductResultError(res, result, fallback) {
  if (result.error === 'PRODUCT_NOT_FOUND') {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found'
    });
  }

  if (result.error === 'INVALID_STATUS_TRANSITION') {
    return sendError(res, {
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
      message: result.message
    });
  }

  return sendError(res, {
    status: 400,
    code: result.error || fallback.code,
    message: result.message || fallback.message,
    details: result.details
  });
}

router.get('/', listProductsValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await productsService.listProducts(companyId, {
    search: req.query.search,
    status: req.query.status,
    category: req.query.category,
    page: parsePositiveInt(req.query.page, 1),
    page_size: parsePositiveInt(req.query.page_size, 20),
    sort_by: req.query.sort_by || 'updated_at',
    sort_order: req.query.sort_order || 'desc',
    include: req.query.include
  });

  return sendSuccess(res, {
    data: result
  });
}));

router.get('/bulk-template', bulkTemplateValidation, validate, asyncHandler(async (req, res) => {
  return sendError(res, {
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'Template download not yet implemented. Please install exceljs: npm install exceljs'
  });
}));

router.post(
  '/bulk-import/validate',
  bulkImportValidateValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    return sendSuccess(res, {
      data: {
        isValid: true,
        totalRows: rows.length,
        validCount: rows.length,
        errorCount: 0,
        warningCount: 0,
        validRows: rows,
        invalidRows: [],
        warnings: []
      }
    });
  })
);

router.post('/bulk-import/file', asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  return sendError(res, {
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'File upload not yet implemented. Please install multer and exceljs: npm install multer exceljs'
  });
}));

router.get('/:id', getProductByIdValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const product = await productsService.getProductById(req.params.id, companyId);
  if (!product) {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found'
    });
  }

  return sendSuccess(res, {
    data: product
  });
}));

router.post('/', createProductValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  try {
    const result = await productsService.createProduct(companyId, req.userId, req.body);

    return sendSuccess(res, {
      status: 201,
      data: result
    });
  } catch (error) {
    if (error.code === 'DUPLICATE_SKU') {
      return sendError(res, {
        status: 400,
        code: 'DUPLICATE_SKU',
        message: error.message
      });
    }

    throw error;
  }
}));

router.put('/:id', updateProductValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await productsService.updateProduct(req.params.id, companyId, req.userId, req.body);
  if (!result.success) {
    return handleProductResultError(res, result, {
      code: 'PRODUCT_UPDATE_FAILED',
      message: 'Unable to update product'
    });
  }

  return sendSuccess(res, {
    data: result.data
  });
}));

router.patch(
  '/:id/status',
  updateProductStatusValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    const result = await productsService.updateProductStatus(
      req.params.id,
      companyId,
      req.userId,
      req.body.status
    );

    if (!result.success) {
      return handleProductResultError(res, result, {
        code: 'PRODUCT_STATUS_UPDATE_FAILED',
        message: 'Unable to update product status'
      });
    }

    return sendSuccess(res, {
      data: result.data
    });
  })
);

router.delete('/:id', deleteProductValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await productsService.deleteProduct(req.params.id, companyId);
  if (!result.success) {
    return handleProductResultError(res, result, {
      code: 'PRODUCT_DELETE_FAILED',
      message: 'Unable to delete product'
    });
  }

  return sendSuccess(res, {
    message: 'Product deleted successfully'
  });
}));

router.post('/bulk-import', bulkImportValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await productsService.bulkImport(
    companyId,
    req.userId,
    req.body.rows,
    req.body.save_mode || 'draft'
  );

  return sendSuccess(res, {
    data: result
  });
}));

module.exports = router;
