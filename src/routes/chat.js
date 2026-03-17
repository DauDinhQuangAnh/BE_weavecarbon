const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validator');
const {
  authenticate,
  requireRole,
  requireCompanyAdmin,
  requireCompanyMember
} = require('../middleware/auth');
const { parsePositiveInt, sendNoCompany, sendSuccess } = require('../utils/http');
const chatService = require('../services/chatService');
const {
  listChatConversationsValidation,
  getChatConversationValidation,
  deleteChatConversationValidation,
  sendChatMessageValidation,
  updateChatSettingsValidation
} = require('../validators/chatValidators');

const router = express.Router();

const ensureCompanyContext = (req, res, next) => {
  if (!req.companyId) {
    return sendNoCompany(res, 'User does not belong to a company', 404);
  }

  return next();
};

router.use(authenticate, requireRole('b2b'), ensureCompanyContext, requireCompanyMember);

router.get(
  '/conversations',
  listChatConversationsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.listConversations(req.userId, req.companyId, {
      page: parsePositiveInt(req.query.page, 1),
      page_size: parsePositiveInt(req.query.page_size, 20)
    });

    return sendSuccess(res, { data });
  })
);

router.get(
  '/conversations/:id',
  getChatConversationValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.getConversationDetail(req.userId, req.companyId, req.params.id);

    return sendSuccess(res, { data });
  })
);

router.delete(
  '/conversations/:id',
  deleteChatConversationValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.deleteConversation(req.userId, req.companyId, req.params.id);

    return sendSuccess(res, {
      data,
      message: 'Conversation deleted successfully'
    });
  })
);

router.post(
  '/messages',
  sendChatMessageValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.sendMessage(req.userId, req.companyId, req.body);

    return sendSuccess(res, { data });
  })
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const data = await chatService.resolveChatSettings(req.userId, req.companyId);

    return sendSuccess(res, { data });
  })
);

router.put(
  '/settings',
  requireCompanyAdmin,
  updateChatSettingsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const config = await chatService.upsertSettings(req.userId, req.companyId, req.body);

    return sendSuccess(res, {
      data: {
        config,
        config_source: 'self',
        can_edit: true
      },
      message: 'Chat settings updated successfully'
    });
  })
);

module.exports = router;
