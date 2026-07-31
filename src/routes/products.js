const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validator');
const productsService = require('../services/productsService');
const { logAuditTrail } = require('../services/auditTrailService');
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

const BULK_TEMPLATE_COLUMNS = [
  ['sku', 'SKU *', 'SKU-20260301-001'],
  ['productName', 'Product Name *', 'Organic Cotton T-shirt'],
  ['productType', 'Product Type *', 'tshirt'],
  ['hsCode', 'HS/CN Code', '62052000'],
  ['facility', 'Facility / Factory', 'Weave Demo Garment Factory - Hanoi'],
  ['quantity', 'Quantity *', '1000'],
  ['weightPerUnit', 'Weight Per Unit (gram) *', '250'],
  ['primaryMaterial', 'Primary Material *', 'organic_cotton'],
  ['primaryMaterialPercentage', 'Primary Material % *', '100'],
  ['secondaryMaterial', 'Secondary Material', 'polyester'],
  ['secondaryMaterialPercentage', 'Secondary Material %', '0'],
  ['accessories', 'Accessories', 'label, thread'],
  ['accessoriesWeightGram', 'Accessories Weight (gram)', '2,5'],
  ['certifications', 'Certifications', 'gots,grs'],
  ['materialSource', 'Material Source *', 'domestic'],
  ['supplierCountry', 'Supplier Country', 'Vietnam'],
  ['supplyGap', 'Supply Gap / Scope 3 Missing', 'false'],
  ['evidenceLookupCode', 'Evidence Lookup Code', 'EVN-HN-009412'],
  ['processes', 'Production Processes *', 'knitting,cutting_sewing,dyeing'],
  ['energySource', 'Energy Source *', 'grid'],
  ['manufacturingLocation', 'Manufacturing Location', 'Bien Hoa, Dong Nai'],
  ['wasteRecovery', 'Waste Recovery', 'partial'],
  ['marketType', 'Market Type *', 'export'],
  ['exportCountry', 'Export Country', 'eu'],
  ['exportComplianceDocuments', 'Export Compliance Documents', 'textile_fibre_composition_labeling'],
  ['customsDeclarationNo', 'Customs Declaration No', '106429381040'],
  ['poContractId', 'PO/Contract ID', 'PO-2026-TXT-099'],
  ['billOfLadingNo', 'Bill of Lading No', 'ONEVNHAN260411'],
  ['containerNo', 'Container No', 'ONEU1234567'],
  ['transportMode', 'Transport Mode', 'sea'],
  ['transportOrigin', 'Transport Origin / Street', 'Tan Hiep Industrial Zone'],
  ['transportOriginCity', 'Origin City', 'Bien Hoa'],
  ['transportOriginStateRegion', 'Origin State / Province', 'Dong Nai'],
  ['transportOriginCountry', 'Origin Country', 'Vietnam'],
  ['transportDestination', 'Transport Destination / Street', 'Port of Rotterdam'],
  ['transportDestinationCity', 'Destination City', 'Rotterdam'],
  ['transportDestinationStateRegion', 'Destination State / Province', 'South Holland'],
  ['transportDestinationCountry', 'Destination Country', 'Netherlands'],
  ['transportDistanceKm', 'Transport Distance (km)', '11922']
];

function escapeCsvValue(value) {
  let text = String(value ?? '');
  // Neutralise CSV/formula injection unless the value is a plain number.
  if (/^[=+\-@\t\r]/.test(text) && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text.trim())) {
    text = "'" + text;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildBulkTemplateCsv() {
  const header = BULK_TEMPLATE_COLUMNS.map((column) => escapeCsvValue(column[0])).join(',');
  const labels = BULK_TEMPLATE_COLUMNS.map((column) => escapeCsvValue(column[1])).join(',');
  const sample = BULK_TEMPLATE_COLUMNS.map((column) => escapeCsvValue(column[2])).join(',');
  return [header, labels, sample].join('\n');
}

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
  const format = req.query.format || 'csv';
  if (format !== 'csv') {
    return sendError(res, {
      status: 501,
      code: 'NOT_IMPLEMENTED',
      message: 'XLSX template download is not enabled on the backend. Use format=csv.'
    });
  }

  const csv = buildBulkTemplateCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="weavecarbon-products-template.csv"');
  return res.status(200).send(csv);
}));

router.get('/bulk-template.xlsx', bulkTemplateValidation, validate, asyncHandler(async (req, res) => {
  return sendError(res, {
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'XLSX template download is not enabled on the backend. Use /bulk-template?format=csv.'
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

    const result = await productsService.validateBulkImportRows(
      companyId,
      Array.isArray(req.body.rows) ? req.body.rows : []
    );

    return sendSuccess(res, { data: result });
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
    await logAuditTrail({
      companyId,
      userId: req.userId,
      dataGroup: 'products',
      changedField: 'product.created',
      newValue: result?.id || req.body?.sku || req.body?.productName || null,
      reason: 'product.create',
      notes: `Created product ${result?.sku || req.body?.sku || result?.name || req.body?.productName || ''}`.trim()
    });

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
  await logAuditTrail({
    companyId,
    userId: req.userId,
    dataGroup: 'products',
    changedField: 'product.updated',
    oldValue: req.params.id,
    newValue: result.data?.id || req.params.id,
    reason: 'product.update',
    notes: `Updated product ${result.data?.sku || result.data?.name || req.params.id}`
  });

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
    await logAuditTrail({
      companyId,
      userId: req.userId,
      dataGroup: 'products',
      changedField: req.body.status === 'published' ? 'product.published' : 'product.updated',
      oldValue: req.params.id,
      newValue: req.body.status,
      reason: 'product.status',
      notes: `Product status changed to ${req.body.status}`
    });

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
  await logAuditTrail({
    companyId,
    userId: req.userId,
    dataGroup: 'products',
    changedField: 'product.created',
    newValue: Array.isArray(req.body.rows) ? `${req.body.rows.length} rows` : 'bulk import',
    reason: 'product.bulk_import',
    notes: `Bulk imported products with save mode ${req.body.save_mode || 'draft'}`
  });

  return sendSuccess(res, {
    data: result
  });
}));

module.exports = router;
