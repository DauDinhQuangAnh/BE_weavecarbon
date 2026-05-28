const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validator');
const {
  authenticate,
  requireRole,
  requireCompanyAdmin,
  requireCompanyMember
} = require('../middleware/auth');
const { sendNoCompany, sendSuccess } = require('../utils/http');
const chatService = require('../services/chatService');
const { updateGlobalAiRuntimeValidation } = require('../validators/aiConfigValidators');

const router = express.Router();

const ensureCompanyContext = (req, res, next) => {
  if (!req.companyId) {
    return sendNoCompany(res, 'User does not belong to a company', 404);
  }

  return next();
};

router.use(authenticate, requireRole('b2b', 'admin'), ensureCompanyContext, requireCompanyMember);

router.get(
  '/runtime',
  asyncHandler(async (req, res) => {
    const data = await chatService.resolveGlobalRuntimeConfig();

    return sendSuccess(res, { data });
  })
);

router.put(
  '/runtime',
  requireCompanyAdmin,
  updateGlobalAiRuntimeValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.upsertGlobalRuntimeConfig(req.body);

    return sendSuccess(res, {
      data,
      message: 'Global AI runtime config updated successfully'
    });
  })
);

module.exports = router;
