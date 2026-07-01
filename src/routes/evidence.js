const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const evidenceService = require('../services/evidenceService');
const chatService = require('../services/chatService');
const { logAuditTrail } = require('../services/auditTrailService');
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

function getEvidenceRagCollectionName(companyId) {
  const prefix = String(process.env.RAG_EVIDENCE_COLLECTION_PREFIX || 'evidence').trim() || 'evidence';
  return `${prefix}_${String(companyId).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

// POST /api/evidence/:id/verify — mark evidence as verified (alias for lock)
router.post('/:id/verify', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.lockEvidence(companyId, req.userId, req.params.id);
  if (!result) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }
  await logAuditTrail({
    companyId,
    userId: req.userId,
    evidenceDocumentId: result.id || req.params.id,
    dataGroup: 'evidence',
    changedField: 'evidence.verified',
    oldValue: 'uploaded',
    newValue: 'verified',
    reason: 'evidence.verify',
    notes: `Verified evidence ${result.fileName || result.documentName || req.params.id}`
  });

  return sendSuccess(res, { data: result });
}));

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
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const result = await evidenceService.createEvidence(companyId, req.userId, {
    evidence_type: kind,
    documentName,
    fileName: file.originalname,
    mime_type: file.mimetype,
    file_size_bytes: file.size,
    checksum_sha256: sha256,
    reportingPeriodStart: req.body.reportingPeriodStart || null,
    reportingPeriodEnd: req.body.reportingPeriodEnd || null,
    sourceVendor: req.body.supplierName || null,
    storage_provider: 'memory',
    notes: req.body.notes || null,
  });

  if (result.error === 'DOCUMENT_NAME_REQUIRED') {
    return sendError(res, { status: 400, code: 'DOCUMENT_NAME_REQUIRED', message: 'File name is required.' });
  }
  await logAuditTrail({
    companyId,
    userId: req.userId,
    evidenceDocumentId: result.data?.id || null,
    dataGroup: 'evidence',
    changedField: 'evidence.uploaded',
    newValue: file.originalname,
    reason: 'evidence.upload',
    notes: `Uploaded ${kind} evidence: ${file.originalname}`
  });

  return sendSuccess(res, { status: 201, data: result.data });
}));

router.post('/:id/rag-ingest', upload.single('file'), asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  if (!req.file) {
    return sendError(res, { status: 400, code: 'FILE_REQUIRED', message: 'No file provided.' });
  }

  const { rows } = await pool.query(
    'SELECT id FROM evidence_documents WHERE id = $1 AND company_id = $2',
    [req.params.id, companyId]
  );

  if (!rows.length) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([req.file.buffer], {
      type: req.file.mimetype || 'application/octet-stream'
    }),
    req.file.originalname || 'evidence-document.pdf'
  );
  formData.append('collection_name', getEvidenceRagCollectionName(companyId));
  formData.append('chunking_profile', String(req.body?.chunking_profile || 'hybrid'));

  const data = await chatService.callGlobalRagEndpoint('/ingest', {
    method: 'POST',
    data: formData
  });

  return sendSuccess(res, { data });
}));

router.get('/', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.listEvidence(companyId, {
    productId: req.query.product_id || req.query.productId,
    lookupCode: req.query.lookup_code || req.query.lookupCode,
    page: req.query.page,
    pageSize: req.query.page_size || req.query.pageSize
  });
  sendSuccess(res, { data: { items: result.items, total: result.total } });
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
  await logAuditTrail({
    companyId,
    userId: req.userId,
    evidenceDocumentId: result.data?.id || null,
    dataGroup: 'evidence',
    changedField: 'evidence.uploaded',
    newValue: result.data?.fileName || result.data?.documentName || req.body?.documentName || req.body?.fileName || null,
    reason: 'evidence.create',
    notes: `Created evidence ${result.data?.documentName || result.data?.fileName || ''}`.trim()
  });

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
  await logAuditTrail({
    companyId,
    userId: req.userId,
    evidenceDocumentId: evidence.id || req.params.id,
    dataGroup: 'evidence',
    changedField: 'evidence.verified',
    oldValue: 'uploaded',
    newValue: 'locked',
    reason: 'evidence.lock',
    notes: `Locked evidence ${evidence.fileName || evidence.documentName || req.params.id}`
  });

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
  await logAuditTrail({
    companyId,
    userId: req.userId,
    evidenceDocumentId: result.id || req.params.id,
    dataGroup: 'evidence',
    changedField: 'evidence.verified',
    oldValue: 'uploaded',
    newValue: 'confirmed',
    reason: 'evidence.confirm',
    notes: `Confirmed evidence ${result.fileName || result.documentName || req.params.id}`
  });

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

  const result = await evidenceService.listEvidence(companyId, { productId });
  return sendSuccess(res, { data: { items: result.items, total: result.total } });
}));

module.exports = router;
