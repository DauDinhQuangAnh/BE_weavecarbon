const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const exportV2Service = require('../services/exportV2Service');
const { logAuditTrail } = require('../services/auditTrailService');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function requireCompany(req, res) {
  if (req.companyId) return req.companyId;
  sendNoCompany(res, 'No company associated with this user');
  return null;
}

function sendXlsx(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(buffer);
}

function sendTemplateError(res, error) {
  return sendError(res, {
    status: 500,
    code: 'TEMPLATE_EXPORT_FAILED',
    message: 'Export XLSX template could not be generated.',
    details: process.env.NODE_ENV === 'production' ? undefined : error.message
  });
}

router.get('/configuration', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const config = await exportV2Service.getConfiguration(companyId);
  return sendSuccess(res, { data: config });
}));

router.put('/configuration', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const config = await exportV2Service.upsertConfiguration(companyId, req.userId, req.body || {});
  return sendSuccess(res, { data: config });
}));

router.post('/dpp-locks', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const productRef = String(req.body.product_id || req.body.productId || req.body.sku || '').trim();
  if (!productRef) {
    return sendError(res, {
      status: 400,
      code: 'PRODUCT_REF_REQUIRED',
      message: 'product_id/productId or sku is required.'
    });
  }

  const lock = await exportV2Service.createDppLock(companyId, req.userId, productRef, req.body || {});
  if (!lock) {
    return sendError(res, {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found for this company.'
    });
  }

  await logAuditTrail({
    companyId,
    userId: req.userId,
    dataGroup: 'exports',
    changedField: 'dpp.locked',
    newValue: lock.id,
    reason: 'export.dpp_lock',
    notes: JSON.stringify({
      sku: lock.sku,
      carbonAuthority: lock.carbonAuthority
    })
  });

  return sendSuccess(res, { status: 201, data: lock });
}));

router.get('/dpp-locks/:id', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const lock = await exportV2Service.getDppLock(companyId, req.params.id);
  if (!lock) {
    return sendError(res, {
      status: 404,
      code: 'DPP_LOCK_NOT_FOUND',
      message: 'DPP lock not found.'
    });
  }

  return sendSuccess(res, { data: lock });
}));

router.get('/documents/commercial-invoice', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  try {
    const result = await exportV2Service.buildCommercialInvoice(companyId);
    return sendXlsx(res, result.filename, result.buffer);
  } catch (error) {
    return sendTemplateError(res, error);
  }
}));

router.get('/documents/packing-list', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  try {
    const result = await exportV2Service.buildPackingList(companyId);
    return sendXlsx(res, result.filename, result.buffer);
  } catch (error) {
    return sendTemplateError(res, error);
  }
}));

router.get('/documents/bill-of-lading', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  try {
    const result = await exportV2Service.buildBillOfLading(companyId);
    return sendXlsx(res, result.filename, result.buffer);
  } catch (error) {
    return sendTemplateError(res, error);
  }
}));

router.post('/buyer-webhook-payload', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const payload = await exportV2Service.buildBuyerWebhookPayload(companyId);
  return sendSuccess(res, { data: payload });
}));

module.exports = router;
