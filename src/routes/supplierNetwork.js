const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { supplierNetworkService } = require('../services/supplierNetworkService');

const router = express.Router();
router.use(authenticate, requireRole('b2b'));
const respond = (res, result, status = 200) => result?.blocked
  ? sendError(res, { status: result.status || 422, code: result.code, message: result.message })
  : sendSuccess(res, { status, data: result });
const audit = (req, field, result, notes) => logAuditTrail({ companyId: req.companyId, userId: req.userId,
  dataGroup: 'supplier_network', changedField: field, newValue: result.id, reason: `g2.${field}`, notes });

router.get('/profiles', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listProfiles(req.companyId))));
router.post('/profiles', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createProfile(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'supplier_profile.revision_created', result, result.supplierReference);
  return respond(res, result, 201);
}));
router.get('/sites', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listSites(req.companyId))));
router.post('/sites', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createSite(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'supplier_site.revision_created', result, result.siteReference);
  return respond(res, result, 201);
}));
router.get('/relationships', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listRelationships(req.companyId))));
router.post('/relationships', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createRelationship(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'supplier_relationship.revision_created', result, result.relationshipReference);
  return respond(res, result, 201);
}));
router.get('/climate-assessments', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listSupplierClimate(req.companyId))));
router.post('/climate-assessments', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createSupplierClimate(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'supplier_climate.assessment_created', result, `${result.hazardType}:${result.scenarioReference}`);
  return respond(res, result, 201);
}));
router.get('/carbon-snapshots', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listCarbonSnapshots(req.companyId))));
router.post('/carbon-snapshots', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createCarbonSnapshot(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'criticality_carbon.snapshot_created', result, result.subjectKind);
  return respond(res, result, 201);
}));
router.get('/criticality-models', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listModels(req.companyId))));
router.post('/criticality-models', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createModel(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'criticality_model.revision_created', result, `${result.modelReference}:${result.revision}`);
  return respond(res, result, 201);
}));
router.get('/criticality-snapshots', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listCriticality(req.companyId))));
router.post('/criticality-snapshots', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createCriticality(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'criticality.snapshot_created', result, `${result.subjectKind}:${result.priorityBand}`);
  return respond(res, result, 201);
}));
router.get('/portfolios', asyncHandler(async (req, res) => respond(res, await supplierNetworkService.listPortfolios(req.companyId))));
router.get('/portfolios/:portfolioId', asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.getPortfolio(req.companyId, req.params.portfolioId);
  return result ? respond(res, result) : sendError(res, { status: 404, code: 'CRITICALITY_PORTFOLIO_NOT_FOUND', message: 'Criticality portfolio not found.' });
}));
router.post('/portfolios', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await supplierNetworkService.createPortfolio(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'criticality_portfolio.snapshot_created', result, result.portfolioReference);
  return respond(res, result, 201);
}));

module.exports = router;
