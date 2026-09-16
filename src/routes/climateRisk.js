const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { climateRiskService } = require('../services/climateRiskService');

const router = express.Router();
router.use(authenticate, requireRole('b2b'));
const respond = (res, result, status = 200) => result?.blocked
  ? sendError(res, { status: result.status || 422, code: result.code, message: result.message })
  : sendSuccess(res, { status, data: result });
const audit = (req, changedField, id, note) => logAuditTrail({ companyId: req.companyId, userId: req.userId,
  dataGroup: 'climate_risk', changedField, newValue: id, reason: `g2.${changedField}`, notes: note });

router.get('/locations', asyncHandler(async (req, res) => respond(res, await climateRiskService.listLocations(req.companyId))));
router.post('/locations', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await climateRiskService.createLocation(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'location.revision_created', result.id, result.facilityRevisionId);
  return respond(res, result, 201);
}));
router.get('/assessments', asyncHandler(async (req, res) => respond(res, await climateRiskService.listAssessments(req.companyId, req.query.limit))));
router.post('/assessments', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await climateRiskService.createAssessment(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'assessment.created', result.id, `${result.hazardType}:${result.scenarioReference}`);
  return respond(res, result, 201);
}));
router.get('/portfolios', asyncHandler(async (req, res) => respond(res, await climateRiskService.listPortfolios(req.companyId))));
router.get('/portfolios/:portfolioId', asyncHandler(async (req, res) => {
  const result = await climateRiskService.getPortfolio(req.companyId, req.params.portfolioId);
  return result ? respond(res, result) : sendError(res, { status: 404, code: 'CLIMATE_PORTFOLIO_NOT_FOUND', message: 'Portfolio snapshot not found.' });
}));
router.post('/portfolios', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const result = await climateRiskService.createPortfolio(req.companyId, req.userId, req.body);
  if (!result.blocked) await audit(req, 'portfolio.snapshot_created', result.id, result.portfolioReference);
  return respond(res, result, 201);
}));
module.exports = router;
