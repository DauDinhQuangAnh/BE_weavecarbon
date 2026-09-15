const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { industrialCoreService } = require('../services/industrialCoreService');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/capabilities', asyncHandler(async (_req, res) => sendSuccess(res, { data: industrialCoreService.capabilities() })));

router.get('/facilities', asyncHandler(async (req, res) => {
  const items = await industrialCoreService.listFacilities(req.companyId);
  if (!items) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  return sendSuccess(res, { data: items });
}));

router.post('/facilities', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await industrialCoreService.createFacility(req.companyId, req.userId, req.body);
  if (!item) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message, details: item.details });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'industrial_core',
    changedField: 'facility.revision_created', newValue: item.id, reason: 'g2.facility_revision_created',
    notes: `${item.facilityReference} revision ${item.revision}` });
  return sendSuccess(res, { status: 201, data: item });
}));

router.get('/activities', asyncHandler(async (req, res) => {
  const items = await industrialCoreService.listActivities(req.companyId, req.query.limit);
  if (!items) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  return sendSuccess(res, { data: items });
}));

router.post('/activities', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await industrialCoreService.createActivity(req.companyId, req.userId, req.body);
  if (!item) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message, details: item.details });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'industrial_core',
    changedField: 'activity.record_created', newValue: item.id, reason: 'g2.activity_record_created', notes: item.activityReference });
  return sendSuccess(res, { status: 201, data: item });
}));

module.exports = router;
