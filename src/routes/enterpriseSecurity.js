const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { enterpriseSecurityService } = require('../services/enterpriseSecurityService');

const router = express.Router();
router.use(authenticate, requireRole('b2b'));
const respond = (res, result, status = 200) => result?.blocked
  ? sendError(res, {
    status: result.status || 422,
    code: result.code,
    message: result.message,
    details: result.details
  })
  : sendSuccess(res, { status, data: result });
const audit = (req, changedField, id, notes) => logAuditTrail({
  companyId: req.companyId,
  userId: req.userId,
  dataGroup: 'enterprise_security',
  changedField,
  newValue: id,
  reason: `g2.${changedField}`,
  notes
});

router.get('/posture', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.getPosture(req.companyId))));

router.get('/policies', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.listPolicies(req.companyId))));
router.post('/policies', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await enterpriseSecurityService.createPolicy(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'policy.revision_created', result.id, `${result.policyReference}:${result.approvalStatus}`);
  return respond(res, result, 201);
}));

router.get('/sso-connections', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.listSsoConnections(req.companyId))));
router.post('/sso-connections', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await enterpriseSecurityService.createSsoConnection(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'sso.revision_created', result.id, `${result.connectionReference}:${result.status}`);
  return respond(res, result, 201);
}));

router.get('/key-events', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.listKeyEvents(req.companyId))));
router.post('/key-events', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await enterpriseSecurityService.createKeyEvent(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'key.lifecycle_event_created', result.id, `${result.keyReference}:${result.lifecycleStatus}`);
  return respond(res, result, 201);
}));

router.get('/incidents', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.listIncidents(req.companyId))));
router.post('/incidents', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await enterpriseSecurityService.createIncidentEvent(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'incident.event_created', result.id, `${result.incidentReference}:${result.eventType}`);
  return respond(res, result, 201);
}));

router.get('/acceptance-runs', asyncHandler(async (req, res) =>
  respond(res, await enterpriseSecurityService.listAcceptanceRuns(req.companyId))));
router.post('/acceptance-runs', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await enterpriseSecurityService.createAcceptanceRun(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'production.acceptance_recorded', result.id, `${result.releaseReference}:${result.decision}`);
  return respond(res, result, 201);
}));

module.exports = router;
