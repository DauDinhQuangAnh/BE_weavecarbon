const express = require('express');
const multer = require('multer');
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
const ragUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

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

router.get(
  '/rag/health',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint('/health');
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/runtime-config',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint('/runtime-config');
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/runtime-status',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint('/runtime-status');
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/collections',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint('/collections');
    return sendSuccess(res, { data });
  })
);

router.post(
  '/rag/collections',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint('/collections', {
      method: 'POST',
      data: {
        name: req.body?.name,
        description: req.body?.description
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/collections/:collection_name',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}`
    );
    return sendSuccess(res, { data });
  })
);

router.patch(
  '/rag/collections/:collection_name',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}`,
      {
        method: 'PATCH',
        data: {
          new_name: req.body?.new_name,
          metadata: req.body?.metadata
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    return sendSuccess(res, { data });
  })
);

router.delete(
  '/rag/collections/:collection_name',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}`,
      {
        method: 'DELETE'
      }
    );
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/collections/:collection_name/records',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}/records`,
      {
        params: {
          limit: req.query.limit,
          offset: req.query.offset
        }
      }
    );
    return sendSuccess(res, { data });
  })
);

router.get(
  '/rag/collections/:collection_name/documents',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}/documents`
    );
    return sendSuccess(res, { data });
  })
);

router.post(
  '/rag/collections/:collection_name/documents/delete',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const source = String(req.body?.source || '').trim();
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}/documents/${encodeURIComponent(source)}`,
      {
        method: 'DELETE'
      }
    );
    return sendSuccess(res, { data });
  })
);

router.post(
  '/rag/ingest',
  requireCompanyAdmin,
  ragUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'file is required'
        }
      });
    }

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([req.file.buffer], {
        type: req.file.mimetype || 'application/octet-stream'
      }),
      req.file.originalname || 'document.pdf'
    );

    if (req.body?.collection_name) {
      formData.append('collection_name', req.body.collection_name);
    }
    if (req.body?.chunking_profile) {
      formData.append('chunking_profile', req.body.chunking_profile);
    }

    const data = await chatService.callGlobalRagEndpoint('/ingest', {
      method: 'POST',
      data: formData
    });
    return sendSuccess(res, { data });
  })
);

router.post(
  '/rag/collections/:collection_name/query',
  asyncHandler(async (req, res) => {
    const data = await chatService.callGlobalRagEndpoint(
      `/collections/${encodeURIComponent(req.params.collection_name)}/query`,
      {
        method: 'POST',
        data: {
          query: req.body?.query,
          number_docs_retrieval: req.body?.number_docs_retrieval,
          include_debug_info: req.body?.include_debug_info === true
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    return sendSuccess(res, { data });
  })
);

module.exports = router;
