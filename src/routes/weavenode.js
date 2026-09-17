const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { weavenodeService } = require('../services/weavenodeService');

const router = express.Router();
const respond = (res, result, status = 200) => result?.blocked
  ? sendError(res, { status: result.status || 422, code: result.code, message: result.message })
  : sendSuccess(res, { status, data: result });
router.post('/ingest', asyncHandler(async (req, res) => respond(res, await weavenodeService.ingest(req.body), 202)));
router.post('/health', asyncHandler(async (req, res) => respond(res, await weavenodeService.ingestHealth(req.body), 202)));
router.use(authenticate, requireRole('b2b'));
router.get('/devices', asyncHandler(async (req, res) => respond(res, await weavenodeService.list(req.companyId))));
router.post('/devices', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.provision(req.companyId, req.userId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'device.provisioned', newValue: result.id, reason: 'g2.weavenode_device_provisioned', notes: result.device_reference });
  return respond(res, result, 201);
}));
router.post('/devices/:deviceId/revoke', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.revoke(req.companyId, req.userId, req.params.deviceId, req.body?.reason);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'device.revoked', newValue: req.params.deviceId, reason: 'g2.weavenode_device_revoked', notes: req.body.reason });
  return respond(res, result, 201);
}));
router.post('/devices/:deviceId/calibrations', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.calibrate(req.companyId, req.userId, req.params.deviceId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'calibration.revision_created', newValue: result.id, reason: 'g2.weavenode_calibration_created', notes: req.params.deviceId });
  return respond(res, result, 201);
}));
router.get('/devices/:deviceId/packets', asyncHandler(async (req, res) => {
  const result = await weavenodeService.packets(req.companyId, req.params.deviceId);
  return result ? respond(res, result) : sendError(res, { status: 404, code: 'WEAVENODE_DEVICE_NOT_FOUND', message: 'Device not found.' });
}));
router.post('/devices/:deviceId/replay', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.replay(req.companyId, req.userId, req.params.deviceId);
  if (!result.blocked && result.accepted.length) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'packets.replayed', newValue: req.params.deviceId, reason: 'g2.weavenode_packets_replayed', notes: String(result.accepted.length) });
  return respond(res, result);
}));
router.get('/devices/:deviceId/health', asyncHandler(async (req, res) => {
  const result = await weavenodeService.health(req.companyId, req.params.deviceId);
  return result ? respond(res, result) : sendError(res, { status: 404, code: 'WEAVENODE_DEVICE_NOT_FOUND', message: 'Device not found.' });
}));
router.get('/meter-hierarchies', asyncHandler(async (req, res) => respond(res, await weavenodeService.listHierarchies(req.companyId))));
router.post('/meter-hierarchies', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.createHierarchy(req.companyId, req.userId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'meter_hierarchy.revision_created', newValue: result.id, reason: 'g2.weavenode_meter_hierarchy_created', notes: result.hierarchyReference });
  return respond(res, result, 201);
}));
router.get('/meter-reconciliations', asyncHandler(async (req, res) => respond(res, await weavenodeService.listReconciliations(req.companyId))));
router.post('/meter-reconciliations', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.reconcile(req.companyId, req.userId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'meter_reconciliation.snapshot_created', newValue: result.id, reason: 'g2.weavenode_meter_reconciliation_created', notes: result.status });
  return respond(res, result, 201);
}));
router.get('/release-keys', requireCompanyAdmin, asyncHandler(async (req, res) => respond(res, await weavenodeService.listSigningKeys(req.companyId))));
router.post('/release-keys', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.createSigningKey(req.companyId, req.userId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'release_key.created', newValue: result.id, reason: 'g2.weavenode_release_key_created', notes: result.key_reference });
  return respond(res, result, 201);
}));
router.post('/release-keys/:keyId/revoke', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.revokeSigningKey(req.companyId, req.userId, req.params.keyId, req.body?.reason);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'release_key.revoked', newValue: req.params.keyId, reason: 'g2.weavenode_release_key_revoked', notes: req.body.reason });
  return respond(res, result, 201);
}));
router.get('/devices/:deviceId/updates', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.listUpdates(req.companyId, req.params.deviceId);
  return result ? respond(res, result) : sendError(res, { status: 404, code: 'WEAVENODE_DEVICE_NOT_FOUND', message: 'Device not found.' });
}));
router.post('/devices/:deviceId/updates', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await weavenodeService.createUpdate(req.companyId, req.userId, req.params.deviceId, req.body);
  if (!result.blocked) await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'weavenode', changedField: 'device_update.revision_created', newValue: result.id, reason: 'g2.weavenode_device_update_created', notes: `${result.updateReference}:${result.rolloutStage}` });
  return respond(res, result, 201);
}));
module.exports = router;
