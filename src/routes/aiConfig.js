const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validator');
const { sendSuccess } = require('../utils/http');
const chatService = require('../services/chatService');
const { updateGlobalAiRuntimeValidation } = require('../validators/aiConfigValidators');

const router = express.Router();

router.get(
  '/runtime',
  asyncHandler(async (req, res) => {
    const data = await chatService.resolveGlobalRuntimeConfig();

    return sendSuccess(res, { data });
  })
);

router.put(
  '/runtime',
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
