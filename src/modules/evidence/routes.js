const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../shared/security');
const { asyncHandler, sendError, sendNoCompany, sendSuccess } = require('../shared/http');
const evidenceService = require('./service');
const chatService = require('../shared/rag');
const logger = require('../shared/logger');
const { expensiveOperationLimiter } = require('../shared/rateLimiter');
const { assertSafeEvidenceUpload } = require('./uploadPolicy');
const {
  removeEvidenceFile,
  storeEvidenceFile,
} = require('./fileStorage');

// Multer buffers the request so the route can hash it and atomically persist the
// original file before creating its database record. The durable copy lives in
// UPLOADS_ROOT and is covered by the platform backup bundle.
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

// Turn an extraction error into a short, user-facing Vietnamese reason for the FE.
function humanizeExtractError(e) {
  const code = e?.code;
  const status = e?.response?.status || e?.statusCode;
  const detail = String(e?.response?.data?.detail || e?.message || '');

  if (code === 'RAG_BACKEND_UNAVAILABLE' || code === 'ECONNREFUSED') {
    return 'Không kết nối được dịch vụ AI đọc chứng từ. Vui lòng thử lại sau ít phút.';
  }
  if (code === 'RAG_BACKEND_TIMEOUT') {
    return 'Dịch vụ AI phản hồi quá lâu (timeout). Thử lại hoặc dùng file nhỏ hơn.';
  }
  if (status === 401 || status === 403) {
    return 'Dịch vụ AI từ chối xác thực. Vui lòng báo quản trị viên kiểm tra cấu hình.';
  }
  if (detail.includes('GEMINI_API_KEY')) {
    return 'Dịch vụ AI chưa được cấu hình (thiếu khóa API). Vui lòng báo quản trị viên.';
  }
  return `AI đọc chứng từ thất bại: ${detail.slice(0, 200) || 'lỗi không xác định'}`;
}

// Fire-and-forget: AI extraction + RAG ingest — both run in background, never block upload response
function processFileAsync(docId, file, kind, companyId) {
  if (!docId || !file?.buffer?.length) return;
  (async () => {
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    const filename = file.originalname || 'document';

    // 1. AI field extraction → extracted_json
    try {
      const extractForm = new FormData();
      extractForm.append('file', blob, filename);
      extractForm.append('kind', kind);
      extractForm.append('language', 'vi');

      logger.info(
        { docId, filename, kind, mimetype: file.mimetype, bytes: file.buffer.length },
        '[evidence] AI extract → calling RAG /extract'
      );

      const result = await chatService.callGlobalRagEndpoint('/extract', {
        method: 'POST',
        data: extractForm,
      });

      const fields = result?.fields ?? result ?? {};
      const fieldCount =
        fields && typeof fields === 'object' ? Object.keys(fields).length : 0;

      if (fieldCount > 0) {
        await evidenceService.updateExtractedJson(companyId, docId, fields, 'ocr_parsed');
        logger.info(
          { docId, fieldCount, keys: Object.keys(fields).slice(0, 20) },
          '[evidence] AI extract OK'
        );
      } else {
        // RAG replied but extracted nothing — this is what shows "chưa trích xuất
        // được trường nào" in the UI. Persist a reason so the FE can explain it.
        logger.warn(
          { docId, filename, kind, resultKeys: result && typeof result === 'object' ? Object.keys(result) : typeof result },
          '[evidence] AI extract returned 0 fields (document parsed but no data extracted)'
        );
        await evidenceService.markExtractionFailed(
          companyId,
          docId,
          'AI đã đọc nhưng không trích xuất được trường dữ liệu nào. '
            + 'Hãy kiểm tra chất lượng ảnh/PDF, hoặc tải file gốc (PDF/XLSX) rõ ràng hơn.'
        );
      }
    } catch (e) {
      // Surface the actionable bits: HTTP status + app error code + upstream RAG detail.
      logger.warn(
        {
          docId,
          filename,
          kind,
          err: e,
          code: e?.code,
          statusCode: e?.statusCode,
          ragStatus: e?.response?.status,
          ragDetail: e?.response?.data?.detail || e?.message,
        },
        `[evidence] AI field extraction FAILED for ${docId}`
      );
      // Persist the reason so it shows up on the FE instead of a silent empty state.
      try {
        await evidenceService.markExtractionFailed(companyId, docId, humanizeExtractError(e));
      } catch (persistErr) {
        logger.warn({ err: persistErr, docId }, '[evidence] failed to persist extraction error');
      }
    }

    // 2. RAG ingest → knowledge base (non-fatal)
    try {
      const ingestForm = new FormData();
      ingestForm.append('file', blob, filename);
      ingestForm.append('collection_name', getEvidenceRagCollectionName(companyId));
      ingestForm.append('chunking_profile', 'hybrid');

      await chatService.callGlobalRagEndpoint('/ingest', {
        method: 'POST',
        data: ingestForm,
      });
    } catch (e) {
      logger.warn({ err: e }, `[evidence] RAG ingest failed for ${docId}`);
    }
  })();
}

// POST /api/evidence/:id/verify — mark evidence as verified (alias for lock)
router.post('/:id/verify', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.lockEvidenceWithAudit(
    companyId,
    req.userId,
    req.params.id,
    'evidence.verify'
  );
  if (!result) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }
  return sendSuccess(res, { data: result });
}));

// POST /api/evidence/upload — multipart/form-data file upload
router.post('/upload', expensiveOperationLimiter, upload.single('file'), asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const file = req.file;
  if (!file) {
    return sendError(res, { status: 400, code: 'FILE_REQUIRED', message: 'No file provided.' });
  }

  const safeUpload = await assertSafeEvidenceUpload(file);
  file.originalname = safeUpload.filename;
  file.mimetype = safeUpload.mime;

  const kind = req.body.kind || req.body.evidence_type || 'other';
  const documentName = req.body.documentName || file.originalname;
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const storedFile = await storeEvidenceFile({
    companyId,
    originalFilename: file.originalname,
    buffer: file.buffer,
  });

  let result;
  try {
    result = await evidenceService.createEvidenceWithAudit(companyId, req.userId, {
      evidence_type: kind,
      documentName,
      fileName: file.originalname,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      checksum_sha256: sha256,
      reportingPeriodStart: req.body.reportingPeriodStart || null,
      reportingPeriodEnd: req.body.reportingPeriodEnd || null,
      sourceVendor: req.body.supplierName || null,
      storage_provider: 'local',
      storage_key: storedFile.storageKey,
      notes: req.body.notes || null,
      auditReason: 'evidence.upload'
    });
  } catch (error) {
    await removeEvidenceFile(storedFile.storageKey).catch((cleanupError) => {
      logger.warn({ err: cleanupError, storageKey: storedFile.storageKey }, '[evidence] failed to roll back stored file');
    });
    throw error;
  }

  if (result.error === 'PRODUCT_NOT_FOUND' || result.error === 'SHIPMENT_NOT_FOUND') {
    await removeEvidenceFile(storedFile.storageKey);
    return sendError(res, {
      status: 404,
      code: result.error,
      message: result.error === 'PRODUCT_NOT_FOUND'
        ? 'Product not found for this company.'
        : 'Shipment not found for this company.'
    });
  }
  if (result.error === 'DOCUMENT_NAME_REQUIRED') {
    await removeEvidenceFile(storedFile.storageKey);
    return sendError(res, { status: 400, code: 'DOCUMENT_NAME_REQUIRED', message: 'File name is required.' });
  }
  // Kick off AI extraction + RAG ingest in background — response returns immediately
  processFileAsync(result.data?.id, file, kind, companyId);

  return sendSuccess(res, { status: 201, data: result.data });
}));

router.post('/:id/rag-ingest', expensiveOperationLimiter, upload.single('file'), asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  if (!req.file) {
    return sendError(res, { status: 400, code: 'FILE_REQUIRED', message: 'No file provided.' });
  }

  if (!(await evidenceService.evidenceExists(companyId, req.params.id))) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  const safeUpload = await assertSafeEvidenceUpload(req.file);
  req.file.originalname = safeUpload.filename;
  req.file.mimetype = safeUpload.mime;

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

  const result = await evidenceService.createEvidenceWithAudit(companyId, req.userId, req.body || {});
  if (result.error === 'PRODUCT_NOT_FOUND') {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found for this company.'
    });
  }
  if (result.error === 'SHIPMENT_NOT_FOUND') {
    return sendError(res, {
      status: 404,
      code: 'SHIPMENT_NOT_FOUND',
      message: 'Shipment not found for this company.'
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

  const evidence = await evidenceService.lockEvidenceWithAudit(
    companyId,
    req.userId,
    req.params.id,
    'evidence.lock'
  );
  if (!evidence) {
    return sendError(res, {
      status: 404,
      code: 'EVIDENCE_NOT_FOUND',
      message: 'Evidence document not found.'
    });
  }
  return sendSuccess(res, { data: evidence });
}));

// GET /api/evidence/:id/status — lightweight poll target for the FE after upload.
// Returns the current extraction status + any failure reason, without the full row.
router.get('/:id/status', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const status = await evidenceService.getEvidenceStatus(companyId, req.params.id);
  if (!status) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  return sendSuccess(res, { data: status });
}));

// GET /api/evidence/:id/fields — return AI-extracted fields from extracted_json
router.get('/:id/fields', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const fields = await evidenceService.getEvidenceFields(companyId, req.params.id);
  if (!fields) {
    return sendError(res, { status: 404, code: 'EVIDENCE_NOT_FOUND', message: 'Evidence document not found.' });
  }

  return sendSuccess(res, { data: fields });
}));

// POST /api/evidence/:id/confirm — mark evidence as reviewed
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const result = await evidenceService.lockEvidenceWithAudit(
    companyId,
    req.userId,
    req.params.id,
    'evidence.confirm'
  );
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

  const result = await evidenceService.listEvidence(companyId, { productId });
  return sendSuccess(res, { data: { items: result.items, total: result.total } });
}));

// DELETE /api/evidence/:id — cascade deletes linked electricity & fuel invoices
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const deleted = await evidenceService.deleteEvidence(companyId, req.params.id);
  if (!deleted) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Evidence document not found.' });
  }
  return sendSuccess(res, { data: { deleted: true } });
}));

module.exports = router;
