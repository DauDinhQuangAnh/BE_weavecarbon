const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const evidenceService = require('../services/evidenceService');
const pool = require('../config/database');

// Keep files in memory (no local disk dependency); 20 MB limit
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function requireCompany(req, res) {
  if (req.companyId) return req.companyId;
  sendNoCompany(res, 'No company associated with this user');
  return null;
}

// POST /api/evidence/upload — multipart/form-data file upload
router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const file = req.file;
  if (!file) {
    return sendError(res, { status: 400, code: 'FILE_REQUIRED', message: 'No file provided.' });
  }

  const kind = req.body.kind || req.body.evidence_type || 'other';
  const documentName = req.body.documentName || file.originalname;

  const result = await evidenceService.createEvidence(companyId, req.userId, {
    evidence_type: kind,
    documentName,
    fileName: file.originalname,
    mime_type: file.mimetype,
    file_size_bytes: file.size,
    reportingPeriodStart: req.body.reportingPeriodStart || null,
    reportingPeriodEnd: req.body.reportingPeriodEnd || null,
    sourceVendor: req.body.supplierName || null,
    storage_provider: 'memory',
    notes: req.body.notes || null,
  });

  if (result.error === 'DOCUMENT_NAME_REQUIRED') {
    return sendError(res, { status: 400, code: 'DOCUMENT_NAME_REQUIRED', message: 'File name is required.' });
  }

  return sendSuccess(res, { status: 201, data: result.data });
}));

router.get('/', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const items = await evidenceService.listEvidence(companyId, {
    productId: req.query.product_id || req.query.productId,
    lookupCode: req.query.lookup_code || req.query.lookupCode
  });
  sendSuccess(res, { data: { items, total: items.length } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.createEvidence(companyId, req.userId, req.body || {});
  if (result.error === 'PRODUCT_NOT_FOUND') {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found for this company.'
    });
  }
  if (result.error === 'DOCUMENT_NAME_REQUIRED') {
    return sendError(res, {
      status: 400,
      code: 'DOCUMENT_NAME_REQUIRED',
      message: 'documentName or fileName is required.'
    });
  }

  return sendSuccess(res, { status: 201, data: result.data });
}));

router.post('/:id/lock', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const evidence = await evidenceService.lockEvidence(companyId, req.userId, req.params.id);
  if (!evidence) {
    return sendError(res, {
      status: 404,
      code: 'EVIDENCE_NOT_FOUND',
      message: 'Evidence document not found.'
    });
  }

  return sendSuccess(res, { data: evidence });
}));

// GET /api/evidence/:id/fields — return AI-extracted fields from extracted_json
router.get('/:id/fields', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const { rows } = await pool.query(
    `SELECT id, extracted_json FROM evidence_documents WHERE id = $1 AND company_id = $2`,
    [req.params.id, companyId]
  );

  if (!rows.length) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  const extracted = rows[0]?.extracted_json ?? {};
  const fields = Object.entries(extracted).map(([key, value]) => ({
    id: key,
    label: key,
    ai_value: String(value ?? ''),
    confirmed_value: null
  }));

  return sendSuccess(res, { data: fields });
}));

// POST /api/evidence/:id/confirm — mark evidence as reviewed
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.lockEvidence(companyId, req.userId, req.params.id);
  if (!result) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  return sendSuccess(res, { data: result });
}));

router.get('/product/:product_id', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const productId = await evidenceService.ensureProductBelongsToCompany(companyId, req.params.product_id);
  if (!productId) {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found for this company.'
    });
  }

  const items = await evidenceService.listEvidence(companyId, { productId });
  return sendSuccess(res, { data: { items, total: items.length } });
}));

module.exports = router;
