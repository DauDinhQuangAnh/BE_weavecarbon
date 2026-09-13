const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { euTextileEprService } = require('../services/euTextileEprService');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/assessments', asyncHandler(async (req, res) => {
  const items = await euTextileEprService.list(req.companyId);
  if (!items) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  return sendSuccess(res, { data: items });
}));

router.post('/assessments', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await euTextileEprService.createRevision(req.companyId, req.userId, req.body);
  if (!item) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'eu_textile_epr',
    changedField: 'assessment.revision_created', newValue: item.id, reason: 'r17.assessment_revision_created',
    notes: `${item.assessmentReference} revision ${item.revision}` });
  return sendSuccess(res, { status: 201, data: item });
}));

router.post('/assessments/:assessmentId/reviews', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await euTextileEprService.review(req.companyId, req.params.assessmentId, req.userId, req.body);
  if (!item) return sendError(res, { status: 404, code: 'EPR_ASSESSMENT_NOT_FOUND', message: 'EPR assessment not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'eu_textile_epr',
    changedField: 'assessment.review_created', newValue: item.id, reason: 'r17.assessment_review_created', notes: item.decision });
  return sendSuccess(res, { status: 201, data: item });
}));

router.post('/assessments/:assessmentId/external-events', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await euTextileEprService.recordExternalEvent(req.companyId, req.params.assessmentId, req.userId, req.body);
  if (!item) return sendError(res, { status: 404, code: 'EPR_ASSESSMENT_NOT_FOUND', message: 'EPR assessment not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'eu_textile_epr',
    changedField: 'external_event.created', newValue: item.id, reason: 'r17.external_event_created', notes: item.eventType });
  return sendSuccess(res, { status: 201, data: item });
}));

module.exports = router;
