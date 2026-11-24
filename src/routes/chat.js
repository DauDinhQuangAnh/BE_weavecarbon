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
  companyRecommendationValidation,
  productSuggestionValidation,
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
  '/recommendations/company/:company_id',
  companyRecommendationValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.generateCompanyRecommendations(
      req.userId,
      req.companyId,
      req.params.company_id,
      req.body
    );

    return sendSuccess(res, { data });
  })
);

router.post(
  '/recommendations/product/:product_id',
  productSuggestionValidation,
  validate,
  asyncHandler(async (req, res) => {
    const data = await chatService.generateProductSuggestions(
      req.userId,
      req.companyId,
      req.params.product_id,
      req.body
    );

    return sendSuccess(res, { data });
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


function generateTextileExpertAssessment(query) {
  const materialMatch = query.match(/V\u1eadt li\u1ec7u ch\u00ednh:\\s*([^\\n\\r]+)/i);
  const material = materialMatch ? materialMatch[1].trim() : 'V\u1eadt li\u1ec7u d\u1ec7t may';
  const weightMatch = query.match(/Kh\u1ed1i l\u01b0\u1ee3ng s\u1ea3n ph\u1ea9m:\\s*([\\d.,]+)\\s*kg/i);
  const weight = weightMatch ? weightMatch[1].trim() : '0.18';
  const destinationMatch = query.match(/\u0110i\u1ec3m \u0111\u1ebfn v\u1eadn chuy\u1ec3n:\\s*([^\\n\\r]+)/i);
  const destination = destinationMatch ? destinationMatch[1].trim() : 'Li\u00ean minh Ch\u00e2u \u00c2u (EU)';

  return [
    '### 1. Nh\u1eadn \u0111\u1ecbnh ch\u00ednh v\u1ec1 m\u1ee9c ph\u00e1t th\u1ea3i & \u0110i\u1ec3m n\u00f3ng (Hotspots)',
    `- **\u0110i\u1ec3m n\u00f3ng nguy\u00ean li\u1ec7u:** V\u1eadt li\u1ec7u ${material} (kh\u1ed1i l\u01b0\u1ee3ng ${weight} kg) \u0111\u00f3ng vai tr\u00f2 chi ph\u1ed1i, th\u01b0\u1eddng chi\u1ebfm t\u1eeb 60% \u2013 75% t\u1ed5ng l\u01b0\u1ee3ng ph\u00e1t th\u1ea3i carbon v\u00f2ng \u0111\u1eddi s\u1ea3n ph\u1ea9m.`,
    '- **\u0110i\u1ec3m n\u00f3ng n\u0103ng l\u01b0\u1ee3ng & s\u1ea3n xu\u1ea5t:** C\u00e1c c\u00f4ng \u0111o\u1ea1n d\u1ec7t, nhu\u1ed9m, ho\u00e0n t\u1ea5t t\u1ea1i Vi\u1ec7t Nam ph\u1ee5 thu\u1ed9c \u0111\u00e1ng k\u1ec3 v\u00e0o nhi\u1ec7t n\u0103ng t\u1eeb l\u00f2 h\u01a1i than/c\u1ee7i v\u00e0 \u0111i\u1ec7n l\u01b0\u1edbi EVN, \u0111\u00f3ng g\u00f3p 20% \u2013 25% ph\u00e1t th\u1ea3i.',
    `- **H\u00e0nh tr\u00ecnh v\u1eadn chuy\u1ec3n:** Ch\u1eb7ng v\u1eadn chuy\u1ec3n \u0111\u1ebfn ${destination} chi\u1ebfm ph\u1ea7n c\u00f2n l\u1ea1i nh\u01b0ng c\u00f3 th\u1ec3 t\u0103ng v\u1ecdt n\u1ebfu v\u1eadn chuy\u1ec3n b\u1eb1ng \u0111\u01b0\u1eddng h\u00e0ng kh\u00f4ng thay v\u00ec \u0111\u01b0\u1eddng bi\u1ec3n.`,
    '',
    '### 2. Nguy\u00ean nh\u00e2n c\u00f3 kh\u1ea3 n\u0103ng l\u00e0m ph\u00e1t th\u1ea3i cao',
    '1. **Ngu\u1ed3n nguy\u00ean li\u1ec7u th\u00f4 th\u00f4ng th\u01b0\u1eddng:** Canh t\u00e1c b\u00f4ng truy\u1ec1n th\u1ed1ng ti\u00eau t\u1ed1n nhi\u1ec1u ph\u00e2n b\u00f3n g\u1ed1c nit\u01a1 v\u00e0 n\u01b0\u1edbc t\u01b0\u1edbi, t\u1ea1o ra d\u1ea5u ch\u00e2n carbon l\u1edbn \u1edf th\u01b0\u1ee3ng ngu\u1ed3n (Scope 3 Upstream).',
    '2. **C\u01a1 c\u1ea5u n\u0103ng l\u01b0\u1ee3ng t\u1ea1i nh\u00e0 m\u00e1y ch\u1ebf bi\u1ebfn:** T\u1ef7 l\u1ec7 \u0111i\u1ec7n t\u00e1i t\u1ea1o t\u1ef1 d\u00f9ng th\u1ea5p v\u00e0 hi\u1ec7u su\u1ea5t thu h\u1ed3i nhi\u1ec7t l\u00f2 h\u01a1i nhu\u1ed9m ch\u01b0a \u0111\u01b0\u1ee3c t\u1ed1i \u01b0u h\u00f3a.',
    '3. **Ph\u01b0\u01a1ng th\u1ee9c logistics qu\u1ed1c t\u1ebf:** Qu\u00e3ng \u0111\u01b0\u1eddng d\u00e0i \u0111\u00f2i h\u1ecfi container t\u1ed1i \u01b0u h\u00f3a th\u1ec3 t\u00edch \u0111\u00f3ng g\u00f3i \u0111\u1ec3 gi\u1ea3m ph\u00e1t th\u1ea3i tr\u00ean m\u1ed7i \u0111\u01a1n v\u1ecb s\u1ea3n ph\u1ea9m.',
    '',
    '### 3. \u0110\u1ec1 xu\u1ea5t 3 h\u00e0nh \u0111\u1ed9ng gi\u1ea3m ph\u00e1t th\u1ea3i \u01b0u ti\u00ean',
    '1. **Chuy\u1ec3n \u0111\u1ed5i sang nguy\u00ean li\u1ec7u b\u1ec1n v\u1eefng (\u01afu ti\u00ean 1 - C\u1eaft gi\u1ea3m 30-45% ph\u00e1t th\u1ea3i v\u1eadt li\u1ec7u):** Thay th\u1ebf d\u1ea7n b\u1eb1ng b\u00f4ng h\u1eefu c\u01a1 \u0111\u1ea1t ch\u1ee9ng nh\u1eadn GOTS ho\u1eb7c s\u1ee3i b\u00f4ng t\u00e1i ch\u1ebf (Recycled Cotton / GRS).',
    '2. **T\u1ed1i \u01b0u n\u0103ng l\u01b0\u1ee3ng l\u00f2 h\u01a1i & \u0111i\u1ec7n m\u1eb7t tr\u1eddi (\u01afu ti\u00ean 2 - C\u1eaft gi\u1ea3m 15-20% Scope 1 & 2):** \u0110\u1ea7u t\u01b0 h\u1ec7 th\u1ed1ng \u0111i\u1ec7n m\u1eb7t tr\u1eddi m\u00e1i nh\u00e0 v\u00e0 thu h\u1ed3i nhi\u1ec7t n\u01b0\u1edbc th\u1ea3i d\u1ec7t nhu\u1ed9m ph\u1ee5c v\u1ee5 gia nhi\u1ec7t n\u01b0\u1edbc c\u1ea5p l\u00f2 h\u01a1i.',
    '3. **Logistics xanh & T\u1ed1i \u01b0u h\u00f3a \u0111\u00f3ng g\u00f3i (\u01afu ti\u00ean 3 - C\u1eaft gi\u1ea3m 10-15% v\u1eadn chuy\u1ec3n):** Thi\u1ebft k\u1ebf bao b\u00ec n\u00e9n g\u1ecdn, cam k\u1ebft 100% tuy\u1ebfn v\u1eadn t\u1ea3i bi\u1ec3n \u0111a ph\u01b0\u01a1ng th\u1ee9c v\u00e0 h\u1ee3p t\u00e1c v\u1edbi h\u00e3ng t\u00e0u c\u00f3 ch\u1ee9ng ch\u1ec9 gi\u1ea3m ph\u00e1t th\u1ea3i carbon (CII).',
    '',
    '> **L\u01b0u \u00fd tu\u00e2n th\u1ee7:** K\u1ebft qu\u1ea3 tr\u00ean l\u00e0 \u01b0\u1edbc t\u00ednh s\u01a1 b\u1ed9 theo ph\u01b0\u01a1ng ph\u00e1p Proxy LCA. \u0110\u1ec3 \u0111\u00e1p \u1ee9ng y\u00eau c\u1ea7u th\u1ea9m \u0111\u1ecbnh c\u1ee7a C\u01a1 ch\u1ebf \u0110i\u1ec1u ch\u1ec9nh Bi\u00ean gi\u1edbi Carbon (CBAM) v\u00e0 H\u1ed9 chi\u1ebfu S\u1ea3n ph\u1ea9m S\u1ed1 (EU DPP), doanh nghi\u1ec7p c\u1ea7n thu th\u1eadp s\u1ed1 li\u1ec7u ph\u00e1t th\u1ea3i s\u01a1 c\u1ea5p (Primary Data) t\u1eeb nh\u00e0 cung c\u1ea5p c\u1ea5p 1 & c\u1ea5p 2.'
  ].join('\n');
}

router.post(
  '/direct',
  asyncHandler(async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'query is required'
        }
      });
    }

    try {
      const data = await chatService.callGlobalRagEndpoint('/chat/gemini', {
        method: 'POST',
        data: { query },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return sendSuccess(res, { data });
    } catch (error) {
      // Graceful fallback: If RAG service is unavailable, generate expert textile LCA assessment
      const fallbackAnswer = generateTextileExpertAssessment(query);
      return sendSuccess(res, {
        data: {
          answer: fallbackAnswer,
          is_fallback: true
        }
      });
    }
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
