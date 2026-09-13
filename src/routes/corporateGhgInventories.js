const express = require('express');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { logAuditTrail } = require('../services/auditTrailService');
const { corporateGhgInventoryService } = require('../services/corporateGhgInventoryService');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/', asyncHandler(async (req, res) => {
  const inventories = await corporateGhgInventoryService.list(req.companyId);
  if (!inventories) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  return sendSuccess(res, { data: inventories });
}));

router.post('/', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const inventory = await corporateGhgInventoryService.createRevision(req.companyId, req.userId, req.body);
  if (!inventory) return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'Active company not found.' });
  if (inventory.blocked) return sendError(res, { status: 422, code: inventory.code, message: inventory.message });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'corporate_ghg_inventory',
    changedField: 'inventory.revision_created', newValue: inventory.id, reason: 'r13.inventory_revision_created',
    notes: `${inventory.inventoryReference} revision ${inventory.revision}` });
  return sendSuccess(res, { status: 201, data: inventory });
}));

router.post('/:inventoryId/reviews', requireCompanyAdmin, asyncHandler(async (req, res) => {
  const review = await corporateGhgInventoryService.review(req.companyId, req.params.inventoryId, req.userId, req.body);
  if (!review) return sendError(res, { status: 404, code: 'GHG_INVENTORY_NOT_FOUND', message: 'Inventory revision not found.' });
  if (review.blocked) return sendError(res, { status: 422, code: review.code, message: review.message });
  await logAuditTrail({ companyId: req.companyId, userId: req.userId, dataGroup: 'corporate_ghg_inventory',
    changedField: 'inventory.review_created', newValue: review.id, reason: 'r13.inventory_review_created', notes: review.decision });
  return sendSuccess(res, { status: 201, data: review });
}));

module.exports = router;
