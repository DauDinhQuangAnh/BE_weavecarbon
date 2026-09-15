const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { dataQualityGovernanceService } = require('../services/dataQualityGovernanceService');

const router = express.Router();
router.use(authenticate); router.use(requireRole('b2b'));
function outcome(res, item, missingCode = 'NO_COMPANY') {
  if (!item) return sendError(res, { status: 404, code: missingCode, message: missingCode === 'NO_COMPANY' ? 'Active company not found.' : 'Record not found.' });
  if (item.blocked) return sendError(res, { status: 422, code: item.code, message: item.message, details: item.details });
  return null;
}

router.get('/dql-assessments', asyncHandler(async (req, res) => { const items = await dataQualityGovernanceService.listDql(req.companyId); return outcome(res, items) || sendSuccess(res, { data: items }); }));
router.post('/dql-assessments', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await dataQualityGovernanceService.createDql(req.companyId, req.userId, req.body); const blocked = outcome(res, item); if (blocked) return blocked;
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'data_quality_governance', changedField: 'dql.assessment_created', newValue: item.id, reason: 'g2.dql_assessment_created', notes: `${item.subjectType}:${item.subjectReference}:${item.dataQualityLevel}` });
  return sendSuccess(res, { status: 201, data: item });
}));
router.get('/factor-proposals', asyncHandler(async (req, res) => { const items = await dataQualityGovernanceService.listFactorProposals(req.companyId); return outcome(res, items) || sendSuccess(res, { data: items }); }));
router.post('/factor-proposals', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await dataQualityGovernanceService.createFactorProposal(req.companyId, req.userId, req.body); const blocked = outcome(res, item); if (blocked) return blocked;
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'data_quality_governance', changedField: 'factor.proposal_created', newValue: item.id, reason: 'g2.factor_proposal_created', notes: item.proposalReference });
  return sendSuccess(res, { status: 201, data: item });
}));
router.post('/factor-proposals/:proposalId/reviews', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const item = await dataQualityGovernanceService.reviewFactorProposal(req.companyId, req.params.proposalId, req.userId, req.body);
  const blocked = outcome(res, item, 'FACTOR_PROPOSAL_NOT_FOUND'); if (blocked) return blocked;
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'data_quality_governance', changedField: 'factor.review_created', newValue: item.id, reason: 'g2.factor_review_created', notes: item.decision });
  return sendSuccess(res, { status: 201, data: item });
}));

module.exports = router;
