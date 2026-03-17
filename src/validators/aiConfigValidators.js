const { body } = require('express-validator');

const updateGlobalAiRuntimeValidation = [
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
  updateGlobalAiRuntimeValidation
};
