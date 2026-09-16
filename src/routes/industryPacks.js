const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { industryPackService } = require('../services/industryPackService');
const router = express.Router(); router.use(authenticate); router.use(requireRole('b2b'));
router.get('/manifests', asyncHandler(async (req, res) => sendSuccess(res, { data: industryPackService.listPacks() })));
router.get('/pilots', asyncHandler(async (req, res) => { const pilots = await industryPackService.listPilots(req.companyId); return pilots ? sendSuccess(res, { data: pilots }) : sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' }); }));
router.post('/pilots', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const pilot = await industryPackService.createPilot(req.companyId, req.userId, req.body);
  if (pilot.blocked) return sendError(res, { status: 422, code: pilot.code, message: pilot.message, details: pilot.details });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'industry_pack', changedField: 'pilot.snapshot_created', newValue: pilot.id, reason: 'g2.industry_pack_pilot_created', notes: pilot.studyReference });
  return sendSuccess(res, { status: 201, data: pilot });
}));
module.exports = router;
