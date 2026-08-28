const express = require('express');
const { supplierRequestsService } = require('./service');
const { authenticate, requireRole } = require('../shared/security');
const { asyncHandler, sendSuccess, sendError, sendNoCompany, parsePositiveInt } = require('../shared/http');

const router = express.Router();
const validStatuses = ['draft', 'sent', 'waiting', 'received', 'overdue'];

router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const limit = parsePositiveInt(req.query.limit, 200);
  const offset = parsePositiveInt(req.query.offset, 0) - 1;
  const page = parsePositiveInt(req.query.page, 1);
  const effectiveOffset = req.query.page ? (page - 1) * limit : Math.max(offset, 0);
  const suppliers = await supplierRequestsService.list({ companyId, limit, offset: effectiveOffset });
  return sendSuccess(res, { data: suppliers });
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const {
    supplier_name, supplierName, supplier_email, supplierEmail,
    material_supplied, materialSupplied, required_data, requiredData,
    deadline, status
  } = req.body;
  const resolvedName = supplierName ?? supplier_name;
  const resolvedEmail = supplierEmail ?? supplier_email;
  const resolvedMaterial = materialSupplied ?? material_supplied ?? null;
  const resolvedData = requiredData ?? required_data;

  if (!resolvedName || !resolvedEmail) {
    return sendError(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'supplier_name and supplier_email are required'
    });
  }

  const supplier = await supplierRequestsService.create({
    companyId,
    userId: req.userId,
    supplier: {
      supplierName: resolvedName,
      supplierEmail: resolvedEmail,
      materialSupplied: resolvedMaterial,
      requiredData: Array.isArray(resolvedData) ? resolvedData : [],
      deadline: deadline || null,
      status: validStatuses.includes(status) ? status : 'draft'
    }
  });
  return sendSuccess(res, { status: 201, data: supplier });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const { id } = req.params;
  const { status, sent_at, sentAt, deadline, required_data, requiredData } = req.body;
  const resolvedSentAt = sentAt ?? sent_at ?? null;
  const resolvedRequiredData = requiredData ?? required_data;

  if (status && !validStatuses.includes(status)) {
    return sendError(res, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: `status must be one of: ${validStatuses.join(', ')}`
    });
  }

  const supplier = await supplierRequestsService.update({
    companyId,
    userId: req.userId,
    id,
    changes: {
      status: status || null,
      sentAt: resolvedSentAt,
      deadline: deadline || null,
      requiredData: Array.isArray(resolvedRequiredData) ? resolvedRequiredData : null
    }
  });
  if (!supplier) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Supplier request not found' });
  }
  return sendSuccess(res, { data: supplier });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  if (!companyId) return sendNoCompany(res);

  const deletedId = await supplierRequestsService.remove({ companyId, id: req.params.id });
  if (!deletedId) {
    return sendError(res, { status: 404, code: 'NOT_FOUND', message: 'Supplier request not found' });
  }
  return sendSuccess(res, { data: { deleted: true, id: deletedId } });
}));

module.exports = router;
