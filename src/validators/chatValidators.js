const { body, param, query } = require('express-validator');

const listChatConversationsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer'),

  query('page_size')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('page_size must be between 1 and 100')
];

const getChatConversationValidation = [
  param('id')
    .isUUID()
    .withMessage('Conversation id must be a valid UUID')
];

const deleteChatConversationValidation = [
  param('id')
    .isUUID()
    .withMessage('Conversation id must be a valid UUID')
];

const sendChatMessageValidation = [
  body('conversation_id')
    .optional()
    .isUUID()
    .withMessage('conversation_id must be a valid UUID'),

  body('content')
    .trim()
    .notEmpty()
    .withMessage('content is required')
    .isLength({ min: 1, max: 4000 })
    .withMessage('content must be between 1 and 4000 characters'),

  body('current_page')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('current_page must be between 1 and 255 characters')
];

const updateChatSettingsValidation = [
  body('rag_base_url')
    .trim()
    .notEmpty()
    .withMessage('rag_base_url is required'),

  body('collection_name')
    .trim()
    .notEmpty()
    .withMessage('collection_name is required')
    .isLength({ min: 1, max: 255 })
    .withMessage('collection_name must be between 1 and 255 characters'),

  body('columns_to_answer')
    .isArray({ min: 1 })
    .withMessage('columns_to_answer must be a non-empty array'),

  body('columns_to_answer.*')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Each columns_to_answer entry must be a non-empty string'),

  body('number_docs_retrieval')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('number_docs_retrieval must be between 1 and 50'),

  body('timeout_ms')
    .optional()
    .isInt({ min: 1000, max: 120000 })
    .withMessage('timeout_ms must be between 1000 and 120000')
];

module.exports = {
  listChatConversationsValidation,
  getChatConversationValidation,
  deleteChatConversationValidation,
  sendChatMessageValidation,
  updateChatSettingsValidation
};
