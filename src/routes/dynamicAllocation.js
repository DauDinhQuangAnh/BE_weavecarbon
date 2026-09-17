const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { dynamicAllocationService } = require('../services/dynamicAllocationService');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('b2b'));

function blocked(res, result) {
  if (!result?.blocked) return false;
  sendError(res, { status: result.code?.endsWith('NOT_FOUND') ? 404 : 422,
    code: result.code, message: result.message, details: result.details });
  return true;
}

router.get('/rules', asyncHandler(async (req, res) => sendSuccess(res, { data: await dynamicAllocationService.listRules(req.companyId) })));

router.post('/rules', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await dynamicAllocationService.createRule(req.companyId, req.userId, req.body);
  if (blocked(res, result)) return;
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'industrial_allocation',
    changedField: 'rule.revision_created', newValue: result.id, reason: 'g2.dynamic_allocation_rule_created',
    notes: `${result.allocationReference} revision ${result.revision}` });
  return sendSuccess(res, { status: 201, data: result });
}));

router.get('/runs', asyncHandler(async (req, res) => sendSuccess(res, { data: await dynamicAllocationService.listRuns(req.companyId, req.query.limit) })));

router.get('/runs/:runId', asyncHandler(async (req, res) => {
  const result = await dynamicAllocationService.getRun(req.companyId, req.params.runId);
  if (!result) return sendError(res, { status: 404, code: 'INDUSTRIAL_ALLOCATION_RUN_NOT_FOUND', message: 'Allocation run was not found.' });
  return sendSuccess(res, { data: result });
}));

router.post('/runs', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await dynamicAllocationService.createRun(req.companyId, req.userId, req.body);
  if (blocked(res, result)) return;
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'industrial_allocation',
    changedField: 'run.created', newValue: result.id, reason: 'g2.dynamic_allocation_run_created',
    notes: `${result.allocationReference} · ${result.sourceLevel}->${result.targetLevel} · ${result.reconciliationStatus}` });
  return sendSuccess(res, { status: 201, data: result });
}));

module.exports = router;
