const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const validate = require('../middleware/validator');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { UPLOADS_ROOT } = require('../config/runtime');
const { expensiveOperationLimiter } = require('../middleware/rateLimiter');
const { uploadPolicy: { assertSafeEvidenceUpload } } = require('../modules/evidence');
const b2cCollectionPointsService = require('../services/b2cCollectionPointsService');
const b2cService = require('../services/b2cService');
const {
  listCollectionPointsValidation,
  listNearbyCollectionPointsValidation,
  listDonationsValidation,
  listRewardTransactionsValidation,
  listCouponsValidation,
  donationParamsValidation
} = require('../validators/b2cValidators');

const router = express.Router();

const toSafePathSegment = (value, fallback = 'unknown') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
};

const donationImageStorage = multer.diskStorage({
  destination: (req, _file, callback) => {
    const userSegment = toSafePathSegment(req.userId, 'user');
    const destinationDir = path.resolve(
      UPLOADS_ROOT,
      'b2c',
      'donations',
      userSegment
    );

    try {
      fs.mkdirSync(destinationDir, { recursive: true });
      callback(null, destinationDir);
    } catch (error) {
      callback(error);
    }
  },
  filename: (_req, file, callback) => {
    const originalName = String(file.originalname || 'donation-image');
    const extension = path.extname(originalName).toLowerCase() || '.jpg';
    const baseName = toSafePathSegment(path.basename(originalName, extension), 'donation');
    callback(null, `${Date.now()}_${baseName}${extension}`);
  }
});

const donationImageUpload = multer({
  storage: donationImageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      callback(new Error('Only image files are allowed.'));
      return;
    }

    callback(null, true);
  }
});

async function validateImageUpload(file) {
  if (!file) return;
  const buffer = file.buffer || await fs.promises.readFile(file.path);
  const safeUpload = await assertSafeEvidenceUpload({ ...file, buffer });
  if (!['.png', '.jpg', '.jpeg'].includes(safeUpload.extension)) {
    const error = new Error('Only PNG and JPEG image files are allowed.');
    error.code = 'UNSAFE_UPLOAD';
    throw error;
  }
  file.originalname = safeUpload.filename;
  file.mimetype = safeUpload.mime;
}

async function removeRejectedUpload(file) {
  if (file?.path) await fs.promises.unlink(file.path).catch(() => {});
}

const uploadDonationImage = (req, res, next) => {
  donationImageUpload.single('source_image')(req, res, async (error) => {
    if (!error) {
      try {
        await validateImageUpload(req.file);
        next();
      } catch (validationError) {
        await removeRejectedUpload(req.file);
        sendError(res, {
          status: validationError.statusCode || 415,
          code: validationError.code || 'INVALID_DONATION_IMAGE',
          message: validationError.message || 'Invalid donation image upload.'
        });
      }
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      sendError(res, {
        status: 400,
        code: 'FILE_TOO_LARGE',
        message: 'Donation image is too large. Maximum size is 10MB.'
      });
      return;
    }

    sendError(res, {
      status: 400,
      code: 'INVALID_DONATION_IMAGE',
      message: error.message || 'Invalid donation image upload.'
    });
  });
};

const analysisImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!mimeType.startsWith('image/')) {
      callback(new Error('Only image files are allowed.'));
      return;
    }

    callback(null, true);
  }
});

const uploadAnalysisImage = (req, res, next) => {
  analysisImageUpload.single('image')(req, res, async (error) => {
    if (!error) {
      try {
        await validateImageUpload(req.file);
        next();
      } catch (validationError) {
        sendError(res, {
          status: validationError.statusCode || 415,
          code: validationError.code || 'INVALID_DONATION_IMAGE',
          message: validationError.message || 'Invalid donation image upload.'
        });
      }
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      sendError(res, {
        status: 400,
        code: 'FILE_TOO_LARGE',
        message: 'Donation image is too large. Maximum size is 10MB.'
      });
      return;
    }

    sendError(res, {
      status: 400,
      code: 'INVALID_DONATION_IMAGE',
      message: error.message || 'Invalid donation image upload.'
    });
  });
};

const parseDonationPayload = (rawPayload) => {
  if (typeof rawPayload !== 'string' || rawPayload.trim().length === 0) {
    throw new Error('Donation payload is required.');
  }

  const parsed = JSON.parse(rawPayload);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Donation payload must be a JSON object.');
  }

  return parsed;
};

const handleB2CError = (res, error) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (!error.code) {
    return false;
  }

  sendError(res, {
    status: error.statusCode || 400,
    code: error.code,
    message: error.message || 'B2C request failed',
    details: error.details
  });
  return true;
};

router.use(authenticate, requireRole('b2c'));

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const payload = await b2cService.getDashboard(req.userId);

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.get(
  '/collection-points',
  listCollectionPointsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cCollectionPointsService.listCollectionPoints({
      category: req.query.category === 'all' ? undefined : req.query.category,
      search: req.query.search,
      city: req.query.city,
      limit: req.query.limit || 20
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.get(
  '/collection-points/nearby',
  listNearbyCollectionPointsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cCollectionPointsService.listNearbyCollectionPoints({
      latitude: req.query.lat,
      longitude: req.query.lng,
      category: req.query.category === 'all' ? undefined : req.query.category,
      search: req.query.search,
      city: req.query.city,
      limit: req.query.limit || 6
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.get(
  '/material-rewards',
  asyncHandler(async (_req, res) => {
    const payload = await b2cService.listMaterialRewards();

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.post(
  '/analyze-donation-image',
  expensiveOperationLimiter,
  uploadAnalysisImage,
  asyncHandler(async (req, res) => {
    try {
      const payload = await b2cService.analyzeDonationImage(req.file, req.body?.category);

      return sendSuccess(res, {
        data: payload
      });
    } catch (error) {
      if (handleB2CError(res, error)) {
        return;
      }
      throw error;
    }
  })
);

router.get(
  '/coupons',
  listCouponsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cService.listCoupons({
      search: req.query.search,
      category: req.query.category,
      status: req.query.status || 'active',
      limit: req.query.limit || 48
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.get(
  '/donations',
  listDonationsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cService.listDonations(req.userId, {
      limit: req.query.limit || 20
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.get(
  '/donations/:id',
  donationParamsValidation,
  validate,
  asyncHandler(async (req, res) => {
    try {
      const payload = await b2cService.getDonationById(req.userId, req.params.id);

      return sendSuccess(res, {
        data: payload
      });
    } catch (error) {
      if (handleB2CError(res, error)) {
        return;
      }
      throw error;
    }
  })
);

router.get(
  '/donations/:id/image',
  donationParamsValidation,
  validate,
  asyncHandler(async (req, res) => {
    try {
      const image = await b2cService.getDonationImage(req.userId, req.params.id);
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Content-Length', String(image.sizeBytes));
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(image.originalName)}"`
      );
      fs.createReadStream(image.filePath).pipe(res);
    } catch (error) {
      if (handleB2CError(res, error)) {
        return;
      }
      throw error;
    }
  })
);

router.get(
  '/reward-transactions',
  listRewardTransactionsValidation,
  validate,
  asyncHandler(async (req, res) => {
    const payload = await b2cService.listRewardTransactions(req.userId, {
      limit: req.query.limit || 30
    });

    return sendSuccess(res, {
      data: payload
    });
  })
);

router.post(
  '/donations',
  expensiveOperationLimiter,
  uploadDonationImage,
  asyncHandler(async (req, res) => {
    let payload;

    try {
      payload = parseDonationPayload(req.body?.payload);
    } catch (error) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // Ignore cleanup failures when payload parsing fails.
        }
      }

      return sendError(res, {
        status: 422,
        code: 'INVALID_DONATION_PAYLOAD',
        message: error.message || 'Donation payload is invalid.'
      });
    }

    try {
      const donation = await b2cService.createDonation(req.userId, payload, req.file);

      return sendSuccess(res, {
        status: 201,
        data: donation
      });
    } catch (error) {
      if (handleB2CError(res, error)) {
        return;
      }
      throw error;
    }
  })
);

module.exports = router;
