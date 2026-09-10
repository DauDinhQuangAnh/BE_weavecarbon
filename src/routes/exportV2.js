const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const exportV2Service = require('../services/exportV2Service');
const exportShipmentService = require('../services/exportShipmentService');
const { logAuditTrail } = require('../services/auditTrailService');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function requireCompany(req, res) {
  if (req.companyId) return req.companyId;
  sendNoCompany(res, 'No company associated with this user');
  return null;
}

function sendNotFound(res) {
  return sendError(res, { status: 404, code: 'SHIPMENT_NOT_FOUND', message: 'Shipment not found for this company.' });
}

function sendLegacyRetired(res) {
  return sendError(res, {
    status: 410,
    code: 'EXPORT_LEGACY_ENDPOINT_RETIRED',
    message: 'This company-scoped export endpoint was retired because it could mix products from different shipments.',
    details: { replacement: '/api/export/shipments/{shipmentId}/documents/{type}/generate' }
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
    changedField: 'dpp.prototype_created',
    newValue: lock.id,
    reason: 'export.dpp_prototype',
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
  if (!requireCompany(req, res)) return;
  return sendLegacyRetired(res);
}));

router.get('/documents/packing-list', asyncHandler(async (req, res) => {
  if (!requireCompany(req, res)) return;
  return sendLegacyRetired(res);
}));

router.get('/documents/bill-of-lading', asyncHandler(async (req, res) => {
  if (!requireCompany(req, res)) return;
  return sendLegacyRetired(res);
}));

router.get('/shipments/:shipmentId/profile', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.getProfile(companyId, req.params.shipmentId);
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { data });
}));

router.put('/shipments/:shipmentId/profile', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.upsertProfile(companyId, req.params.shipmentId, req.userId, req.body || {});
  if (!data) return sendNotFound(res);
  await logAuditTrail({ companyId, userId: req.userId, dataGroup: 'exports', changedField: 'shipment_export.profile', newValue: req.params.shipmentId, reason: 'export.profile.update' });
  return sendSuccess(res, { data });
}));

router.post('/shipments/:shipmentId/lines/sync', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.syncLinesFromShipment(companyId, req.params.shipmentId);
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { data });
}));

router.post('/shipments/:shipmentId/lines', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.createLine(companyId, req.params.shipmentId, req.body || {}, req.userId);
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { status: 201, data });
}));

router.patch('/shipments/:shipmentId/lines/:lineId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.updateLine(companyId, req.params.shipmentId, req.params.lineId, req.body || {}, req.userId);
  if (!data) return sendError(res, { status: 404, code: 'EXPORT_LINE_NOT_FOUND', message: 'Export line not found.' });
  return sendSuccess(res, { data });
}));

router.delete('/shipments/:shipmentId/lines/:lineId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const deleted = await exportShipmentService.deleteLine(companyId, req.params.shipmentId, req.params.lineId);
  if (!deleted) return sendError(res, { status: 404, code: 'EXPORT_LINE_NOT_FOUND', message: 'Export line not found.' });
  return sendSuccess(res, { data: { deleted: true } });
}));

router.post('/shipments/:shipmentId/containers', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.createContainer(companyId, req.params.shipmentId, req.body || {});
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { status: 201, data });
}));

router.patch('/shipments/:shipmentId/containers/:containerId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.updateContainer(companyId, req.params.shipmentId, req.params.containerId, req.body || {});
  if (!data) return sendError(res, { status: 404, code: 'EXPORT_CONTAINER_NOT_FOUND', message: 'Container not found.' });
  return sendSuccess(res, { data });
}));

router.delete('/shipments/:shipmentId/containers/:containerId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const deleted = await exportShipmentService.deleteContainer(companyId, req.params.shipmentId, req.params.containerId);
    if (!deleted) return sendError(res, { status: 404, code: 'EXPORT_CONTAINER_NOT_FOUND', message: 'Container not found.' });
    return sendSuccess(res, { data: { deleted: true } });
  } catch (error) {
    if (error.code === '23503') return sendError(res, { status: 409, code: 'EXPORT_CONTAINER_IN_USE', message: 'Move or delete linked pallets and packages before deleting this container.' });
    throw error;
  }
}));

router.post('/shipments/:shipmentId/packages', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.createPackage(companyId, req.params.shipmentId, req.body || {});
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { status: 201, data });
}));

router.patch('/shipments/:shipmentId/packages/:packageId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.updatePackage(companyId, req.params.shipmentId, req.params.packageId, req.body || {});
  if (!data) return sendError(res, { status: 404, code: 'EXPORT_PACKAGE_NOT_FOUND', message: 'Package not found.' });
  return sendSuccess(res, { data });
}));

router.delete('/shipments/:shipmentId/packages/:packageId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const deleted = await exportShipmentService.deletePackage(companyId, req.params.shipmentId, req.params.packageId);
  if (!deleted) return sendError(res, { status: 404, code: 'EXPORT_PACKAGE_NOT_FOUND', message: 'Package not found.' });
  return sendSuccess(res, { data: { deleted: true } });
}));

router.post('/shipments/:shipmentId/carrier-documents', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.createCarrierDocument(
    companyId, req.params.shipmentId, req.userId, req.body || {}
  );
  if (!result) return sendNotFound(res);
  if (result.error) {
    const messages = {
      CARRIER_DOCUMENT_TYPE_INVALID: 'Unsupported carrier document type.',
      CARRIER_DOCUMENT_IDENTITY_REQUIRED: 'Document type, compatible transport mode and document number are required.',
      CARRIER_DOCUMENT_VALUE_INVALID: 'Carrier metadata contains an unsupported value or invalid total.',
      CARRIER_EVIDENCE_NOT_FOUND: 'Carrier evidence file was not found for this shipment.',
      CARRIER_EVIDENCE_ALREADY_LINKED: 'This evidence file already has structured carrier metadata.',
      CARRIER_SUPERSEDES_NOT_FOUND: 'The carrier document selected for replacement is not an active confirmed version.'
    };
    return sendError(res, { status: result.error.includes('NOT_FOUND') ? 404 : 400, code: result.error, message: messages[result.error] });
  }
  await logAuditTrail({
    companyId, userId: req.userId, dataGroup: 'exports',
    changedField: 'shipment_export.carrier_document.draft_created', newValue: result.structured.id,
    reason: 'export.carrier_document.create', notes: `${result.structured.documentType}:${result.structured.documentNumber}`
  });
  return sendSuccess(res, { status: 201, data: result });
}));

router.patch('/shipments/:shipmentId/carrier-documents/:carrierDocumentId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.updateCarrierDocument(
    companyId, req.params.shipmentId, req.params.carrierDocumentId, req.body || {}
  );
  if (!result) return sendError(res, { status: 404, code: 'CARRIER_DOCUMENT_NOT_FOUND', message: 'Carrier document metadata not found.' });
  if (result.error) return sendError(res, {
    status: result.error === 'CARRIER_DOCUMENT_IMMUTABLE' ? 409 : 400,
    code: result.error,
    message: result.error === 'CARRIER_DOCUMENT_IMMUTABLE'
      ? 'Confirmed carrier document metadata is immutable.'
      : 'Carrier metadata contains an unsupported value or incomplete identity.'
  });
  return sendSuccess(res, { data: result });
}));

router.delete('/shipments/:shipmentId/carrier-documents/:carrierDocumentId', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const deleted = await exportShipmentService.deleteCarrierDocument(
    companyId, req.params.shipmentId, req.params.carrierDocumentId
  );
  if (!deleted) return sendError(res, { status: 409, code: 'CARRIER_DOCUMENT_NOT_DRAFT', message: 'Only draft carrier metadata can be deleted.' });
  return sendSuccess(res, { data: { deleted: true } });
}));

router.get('/shipments/:shipmentId/carrier-documents/:carrierDocumentId/reconciliation', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.reconcileCarrierDocument(
    companyId, req.params.shipmentId, req.params.carrierDocumentId
  );
  if (!result) return sendError(res, { status: 404, code: 'CARRIER_DOCUMENT_NOT_FOUND', message: 'Carrier document metadata not found.' });
  return sendSuccess(res, { data: result });
}));

router.post('/shipments/:shipmentId/carrier-documents/:carrierDocumentId/confirm', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.confirmCarrierDocument(
    companyId, req.params.shipmentId, req.params.carrierDocumentId, req.userId, req.body || {}
  );
  if (!result) return sendError(res, { status: 404, code: 'CARRIER_DOCUMENT_NOT_FOUND', message: 'Carrier document metadata not found.' });
  if (result.error) {
    const messages = {
      CARRIER_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED: 'Explicit metadata confirmation and a confirmation note are required.',
      CARRIER_RECONCILIATION_FAILED: 'Carrier metadata does not reconcile with the shipment dossier.',
      CARRIER_DOCUMENT_IMMUTABLE: 'Confirmed carrier document metadata is immutable.',
      CARRIER_REPLACEMENT_LINK_REQUIRED: 'Link this draft to the active carrier document that it replaces.',
      CARRIER_CONFIRMATION_IDENTITY_REQUIRED: 'The confirming user requires a stable name or email.',
      CARRIER_EVIDENCE_STORAGE_UNSUPPORTED: 'Carrier evidence must be available in verified local storage before confirmation.',
      CARRIER_EVIDENCE_FILE_UNAVAILABLE: 'Carrier evidence file is missing or cannot be read.',
      CARRIER_EVIDENCE_FILE_TAMPERED: 'Carrier evidence bytes no longer match the stored size and SHA-256.'
    };
    return sendError(res, { status: 409, code: result.error, message: messages[result.error], details: result.reconciliation });
  }
  await logAuditTrail({
    companyId, userId: req.userId, dataGroup: 'exports',
    changedField: 'shipment_export.carrier_document.confirmed', newValue: result.structured.id,
    reason: 'export.carrier_document.confirm', notes: `${result.structured.documentType}:${result.structured.documentNumber}`
  });
  return sendSuccess(res, { data: result });
}));

router.get('/shipments/:shipmentId/readiness', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const data = await exportShipmentService.getReadiness(companyId, req.params.shipmentId);
  if (!data) return sendNotFound(res);
  return sendSuccess(res, { data });
}));

router.post('/shipments/:shipmentId/documents/:type/generate', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const result = await exportShipmentService.createDocumentJob(companyId, req.params.shipmentId, req.userId, req.params.type, req.body || {});
    if (!result) return sendNotFound(res);
    if (result.blocked) return sendError(res, {
      status: 409,
      code: result.code || 'EXPORT_DOCUMENT_BLOCKED',
      message: result.message || 'Required shipment data is incomplete.',
      details: result.readiness
    });
    await logAuditTrail({ companyId, userId: req.userId, dataGroup: 'exports', changedField: 'shipment_export.document.generated', newValue: result.id, reason: 'export.document.generate', notes: `${req.params.type}:${result.outputFormat || 'default'}` });
    return sendSuccess(res, { status: 202, data: result });
  } catch (error) {
    if (['INVALID_DOCUMENT_TYPE', 'INVALID_DOCUMENT_FORMAT'].includes(error.code)) return sendError(res, { status: 400, code: error.code, message: error.message });
    throw error;
  }
}));

router.get('/shipments/:shipmentId/documents/:id/reviews', asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.getDocumentReviews(companyId, req.params.shipmentId, req.params.id);
  if (!result) return sendError(res, { status: 404, code: 'EXPORT_DOCUMENT_NOT_FOUND', message: 'Export document not found.' });
  return sendSuccess(res, { data: result });
}));

router.post('/shipments/:shipmentId/documents/:id/reviews', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.reviewDocument(
    companyId, req.params.shipmentId, req.params.id, req.userId, req.body || {}
  );
  if (!result) return sendError(res, { status: 404, code: 'EXPORT_DOCUMENT_NOT_FOUND', message: 'Export document not found.' });
  if (result.blocked) return sendError(res, { status: 409, code: result.code, message: result.message });
  await logAuditTrail({
    companyId,
    userId: req.userId,
    dataGroup: 'exports',
    changedField: 'shipment_export.document.reviewed',
    newValue: result.id,
    reason: 'export.document.review',
    notes: JSON.stringify({ documentId: result.documentId, role: result.reviewerRole, decision: result.decision })
  });
  return sendSuccess(res, { status: 201, data: result });
}));

router.post('/shipments/:shipmentId/documents/:id/issue', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = await exportShipmentService.issueDocument(companyId, req.params.shipmentId, req.params.id, req.userId);
  if (!result) return sendError(res, { status: 404, code: 'EXPORT_DOCUMENT_NOT_FOUND', message: 'Export document not found.' });
  if (result.blocked) return sendError(res, { status: 409, code: result.code || 'EXPORT_DOCUMENT_BLOCKED', message: result.message || 'Document cannot be issued.', details: result.readiness });
  await logAuditTrail({ companyId, userId: req.userId, dataGroup: 'exports', changedField: 'shipment_export.document.issued', newValue: result.id, reason: 'export.document.issue', notes: result.type });
  return sendSuccess(res, { data: result });
}));

router.post('/buyer-webhook-payload', asyncHandler(async (req, res) => {
  if (!requireCompany(req, res)) return;
  return sendLegacyRetired(res);
}));

module.exports = router;
