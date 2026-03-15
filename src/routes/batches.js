const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validator');
const batchesService = require('../services/batchesService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePositiveInt, sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const {
  listBatchesValidation,
  getBatchByIdValidation,
  createBatchValidation,
  updateBatchValidation,
  deleteBatchValidation,
  addBatchItemValidation,
  updateBatchItemValidation,
  deleteBatchItemValidation,
  publishBatchValidation
} = require('../validators/batchesValidators');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

function ensureCompanyId(req, res) {
  if (req.companyId) {
    return req.companyId;
  }

  sendNoCompany(res, 'User is not associated with any company');
  return null;
}

function handleBatchError(res, error) {
  const mappedError = {
    BATCH_NOT_FOUND: {
      status: 404,
      code: 'BATCH_NOT_FOUND',
      message: 'Batch not found'
    },
    PRODUCT_NOT_FOUND: {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product not found'
    },
    BATCH_ITEM_NOT_FOUND: {
      status: 404,
      code: 'BATCH_ITEM_NOT_FOUND',
      message: 'Product not found in batch'
    },
    BATCH_ALREADY_PUBLISHED: {
      status: 400,
      code: 'INVALID_BATCH_STATUS_TRANSITION',
      message: 'Cannot add items to published batch'
    },
    BATCH_EMPTY: {
      status: 400,
      code: 'BATCH_EMPTY',
      message: 'Cannot publish empty batch'
    }
  }[error.message];

  if (mappedError) {
    sendError(res, mappedError);
    return true;
  }

  if (error.code === '23505') {
    sendError(res, {
      status: 400,
      code: 'DUPLICATE_BATCH_ITEM',
      message: 'Product already exists in this batch'
    });
    return true;
  }

  return false;
}

router.get('/', listBatchesValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await batchesService.listBatches(companyId, {
    search: req.query.search,
    status: req.query.status,
    page: parsePositiveInt(req.query.page, 1),
    page_size: parsePositiveInt(req.query.page_size, 20)
  });

  return sendSuccess(res, {
    data: result
  });
}));

router.get('/:id', getBatchByIdValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const batch = await batchesService.getBatchById(req.params.id, companyId);
  if (!batch) {
    return sendError(res, {
      status: 404,
      code: 'BATCH_NOT_FOUND',
      message: 'Batch not found'
    });
  }

  return sendSuccess(res, {
    data: batch
  });
}));

router.post('/', createBatchValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await batchesService.createBatch(companyId, req.userId, req.body);

  return sendSuccess(res, {
    status: 201,
    data: result
  });
}));

router.patch('/:id', updateBatchValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const result = await batchesService.updateBatch(req.params.id, companyId, req.body);
  if (!result) {
    return sendError(res, {
      status: 404,
      code: 'BATCH_NOT_FOUND',
      message: 'Batch not found'
    });
  }

  return sendSuccess(res, {
    data: result
  });
}));

router.delete('/:id', deleteBatchValidation, validate, asyncHandler(async (req, res) => {
  const companyId = ensureCompanyId(req, res);
  if (!companyId) {
    return;
  }

  const deleted = await batchesService.deleteBatch(req.params.id, companyId);
  if (!deleted) {
    return sendError(res, {
      status: 404,
      code: 'BATCH_NOT_FOUND',
      message: 'Batch not found'
    });
  }

  return sendSuccess(res, {
    message: 'Batch archived successfully'
  });
}));

router.post(
  '/:id/items',
  addBatchItemValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await batchesService.addBatchItem(req.params.id, companyId, req.body);

      return sendSuccess(res, {
        status: 201,
        data: result
      });
    } catch (error) {
      if (handleBatchError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

router.patch(
  '/:id/items/:product_id',
  updateBatchItemValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await batchesService.updateBatchItem(
        req.params.id,
        companyId,
        req.params.product_id,
        req.body
      );

      return sendSuccess(res, {
        data: result
      });
    } catch (error) {
      if (handleBatchError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

router.delete(
  '/:id/items/:product_id',
  deleteBatchItemValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      await batchesService.deleteBatchItem(req.params.id, companyId, req.params.product_id);

      return sendSuccess(res, {
        message: 'Item removed from batch successfully'
      });
    } catch (error) {
      if (handleBatchError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

router.patch(
  '/:id/publish',
  publishBatchValidation,
  validate,
  asyncHandler(async (req, res) => {
    const companyId = ensureCompanyId(req, res);
    if (!companyId) {
      return;
    }

    try {
      const result = await batchesService.publishBatch(req.params.id, companyId, req.userId);

      return sendSuccess(res, {
        data: result
      });
    } catch (error) {
      if (error.message === 'BATCH_ALREADY_PUBLISHED') {
        return sendError(res, {
          status: 400,
          code: 'INVALID_BATCH_STATUS_TRANSITION',
          message: 'Batch is already published'
        });
      }

      if (handleBatchError(res, error)) {
        return;
      }

      throw error;
    }
  })
);

module.exports = router;
