const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { UPLOADS_ROOT } = require('../config/runtime');
const validate = require('../middleware/validator');
const exportMarketsService = require('../services/exportMarketsService');
const {
    recommendationActionValidation,
    addProductToScopeValidation,
    updateProductInScopeValidation,
    removeProductFromScopeValidation,
    updateCarbonDataValidation,
    documentParamsValidation,
    approveDocumentValidation,
    importDocumentsValidation,
    generateComplianceReportValidation
} = require('../validators/exportMarketsValidators');

const ENABLE_DEV_PLACEHOLDER_DOWNLOAD =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_DOWNLOAD_PLACEHOLDER === 'true';

function writeDevPlaceholderDocument(filePath, filename, marketCode) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = [
        'WeaveCarbon Dev Placeholder Document',
        `Document: ${filename}`,
        `Market: ${marketCode}`,
        `Generated: ${new Date().toISOString()}`
    ].join('\n');
    fs.writeFileSync(filePath, content);
}

function toSafePathSegment(value, fallback = 'unknown') {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    return normalized || fallback;
}

const complianceUploadStorage = multer.diskStorage({
    destination: (req, _file, callback) => {
        const companySegment = toSafePathSegment(req.companyId, 'company');
        const marketSegment = toSafePathSegment(String(req.params.market_code || '').toUpperCase(), 'market');
        const documentSegment = toSafePathSegment(req.params.document_id, 'document');
        const destinationDir = path.resolve(
            UPLOADS_ROOT,
            'compliance',
            companySegment,
            marketSegment,
            documentSegment
        );

        try {
            fs.mkdirSync(destinationDir, { recursive: true });
            callback(null, destinationDir);
        } catch (error) {
            callback(error);
        }
    },
    filename: (_req, file, callback) => {
        const originalName = String(file.originalname || 'document.pdf');
        const extension = path.extname(originalName).toLowerCase() || '.pdf';
        const baseName = toSafePathSegment(path.basename(originalName, extension), 'document');
        callback(null, `${Date.now()}_${baseName}${extension}`);
    }
});

const complianceUpload = multer({
    storage: complianceUploadStorage,
    limits: {
        fileSize: 20 * 1024 * 1024
    },
    fileFilter: (_req, file, callback) => {
        const mimeType = String(file.mimetype || '').toLowerCase();
        const originalName = String(file.originalname || '').toLowerCase();
        const isPdf = mimeType === 'application/pdf' || originalName.endsWith('.pdf');

        if (!isPdf) {
            callback(new Error('Only PDF files are allowed.'));
            return;
        }

        callback(null, true);
    }
});

function uploadComplianceDocumentFile(req, res, next) {
    complianceUpload.single('file')(req, res, (error) => {
        if (!error) {
            return next();
        }

        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'FILE_TOO_LARGE',
                    message: 'File is too large. Maximum allowed size is 20MB.'
                }
            });
        }

        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_UPLOAD_FILE',
                message: error.message || 'Invalid upload file.'
            }
        });
    });
}

// =============================================
// Helper: check companyId
// =============================================
function requireCompany(req, res) {
    if (!req.companyId) {
        res.status(404).json({
            success: false,
            error: {
                code: 'NO_COMPANY',
                message: 'No company associated with this user'
            }
        });
        return false;
    }
    return true;
}

function handleServiceError(res, result) {
    const statusMap = {
        'MARKET_NOT_FOUND': 404,
        'RECOMMENDATION_NOT_FOUND': 404,
        'PRODUCT_NOT_FOUND': 404,
        'PRODUCT_SCOPE_NOT_FOUND': 404,
        'DOCUMENT_NOT_FOUND': 404,
        'DOCUMENT_NOT_UPLOADED': 409,        'DOCUMENT_FILE_NOT_FOUND': 404,        'MARKET_NOT_READY': 400,
        'INVALID_ACTION': 400
    };

    const status = statusMap[result.error] || 400;
    return res.status(status).json({
        success: false,
        error: {
            code: result.error,
            message: result.message || result.error
        }
    });
}

function parseProductIds(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed
                .map((item) => String(item || '').trim())
                .filter(Boolean);
        }
    } catch {
        // ignore json parse error and continue with split mode
    }

    return trimmed
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

// =============================================
// 3.1 GET /api/export/markets
// List all market compliance data
// =============================================
router.get(
    '/',
    authenticate,
    requireRole('b2b'),
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const markets = await exportMarketsService.listMarkets(req.companyId);

            return res.status(200).json({
                success: true,
                data: markets
            });
        } catch (error) {
            console.error('Error listing export markets:', error);
            next(error);
        }
    }
);

// =============================================
// 3.2 POST /api/export/markets/:market_code/recommendations/:recommendation_id/actions
// Perform action on a recommendation
// =============================================
router.post(
    '/:market_code/recommendations/:recommendation_id/actions',
    authenticate,
    requireRole('b2b'),
    recommendationActionValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.performRecommendationAction(
                req.companyId,
                req.params.market_code,
                req.params.recommendation_id,
                req.body.action
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error performing recommendation action:', error);
            next(error);
        }
    }
);

// =============================================
// 3.3a POST /api/export/markets/:market_code/products
// Add product to market scope
// =============================================
router.post(
    '/:market_code/products',
    authenticate,
    requireRole('b2b'),
    addProductToScopeValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.addProductToScope(
                req.companyId,
                req.params.market_code,
                {
                    product_id: req.body.product_id,
                    hs_code: req.body.hs_code,
                    notes: req.body.notes
                }
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(201).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error adding product to scope:', error);
            next(error);
        }
    }
);

// =============================================
// 3.3b PATCH /api/export/markets/:market_code/products/:product_id
// Update product in market scope
// =============================================
router.patch(
    '/:market_code/products/:product_id',
    authenticate,
    requireRole('b2b'),
    updateProductInScopeValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.updateProductInScope(
                req.companyId,
                req.params.market_code,
                req.params.product_id,
                {
                    hs_code: req.body.hs_code,
                    notes: req.body.notes
                }
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error updating product scope:', error);
            next(error);
        }
    }
);

// =============================================
// 3.3c DELETE /api/export/markets/:market_code/products/:product_id
// Remove product from market scope
// =============================================
router.delete(
    '/:market_code/products/:product_id',
    authenticate,
    requireRole('b2b'),
    removeProductFromScopeValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.removeProductFromScope(
                req.companyId,
                req.params.market_code,
                req.params.product_id
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                message: 'Product removed from scope'
            });
        } catch (error) {
            console.error('Error removing product from scope:', error);
            next(error);
        }
    }
);

// =============================================
// 3.4 PATCH /api/export/markets/:market_code/carbon-data/:scope
// Update carbon data for a specific scope
// =============================================
router.patch(
    '/:market_code/carbon-data/:scope',
    authenticate,
    requireRole('b2b'),
    updateCarbonDataValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.updateCarbonData(
                req.companyId,
                req.params.market_code,
                req.params.scope,
                {
                    value: req.body.value,
                    unit: req.body.unit,
                    methodology: req.body.methodology,
                    data_source: req.body.data_source,
                    reporting_period: req.body.reporting_period
                }
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error updating carbon data:', error);
            next(error);
        }
    }
);

// =============================================
// 3.5a POST /api/export/markets/:market_code/documents/:document_id/upload
// Upload document (multipart/form-data)
// =============================================
router.post(
    '/:market_code/documents/:document_id/upload',
    authenticate,
    requireRole('b2b'),
    documentParamsValidation,
    validate,
    uploadComplianceDocumentFile,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const body = req.body || {};
            const uploadedFile = req.file || null;
            const normalizedStorageKey = uploadedFile
                ? path.relative(UPLOADS_ROOT, uploadedFile.path).replace(/\\/g, '/')
                : (body.storage_key || body.document_path || body.file_path || null);

            if (!normalizedStorageKey) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'DOCUMENT_FILE_REQUIRED',
                        message: 'No document file provided.'
                    }
                });
            }

            const fileData = {
                document_name: body.document_name || uploadedFile?.originalname || 'Uploaded Document',
                document_code: body.document_code || null,
                original_filename: body.original_filename || uploadedFile?.originalname || body.document_name || 'document.pdf',
                storage_provider: 'local',
                storage_bucket: null,
                file_size_bytes: uploadedFile?.size || body.file_size_bytes || 0,
                mime_type: uploadedFile?.mimetype || body.mime_type || 'application/pdf',
                checksum_sha256: body.checksum_sha256 || null,
                storage_key: normalizedStorageKey,
                status: body.status || 'uploaded'
            };

            const productIds = parseProductIds(body.product_ids || body.productIds);

            const result = await exportMarketsService.uploadDocument(
                req.companyId,
                req.params.market_code,
                req.params.document_id,
                req.userId,
                fileData,
                {
                    product_ids: productIds,
                    source: 'manual'
                }
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error uploading document:', error);
            next(error);
        }
    }
);

// =============================================
// 3.5a1 POST /api/export/markets/:market_code/documents/import
// Import document mappings for products
// =============================================
router.post(
    '/:market_code/documents/import',
    authenticate,
    requireRole('b2b'),
    importDocumentsValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.importDocumentMappings(
                req.companyId,
                req.params.market_code,
                req.userId,
                req.body.rows
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error importing document mappings:', error);
            next(error);
        }
    }
);

// =============================================
// 3.5b GET /api/export/markets/:market_code/documents/:document_id/download
// Download document - returns binary file, NOT JSON (per section 5.5)
// =============================================
router.get(
    '/:market_code/documents/:document_id/download',
    authenticate,
    requireRole('b2b'),
    documentParamsValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.getDocumentDownload(
                req.companyId,
                req.params.market_code,
                req.params.document_id
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            const doc = result.data;
            const storageProvider = doc.storage_provider || 'local';
            const storageKey = doc.storage_key;
            const originalFilename = doc.original_filename || 'document';
            const mimeType = doc.mime_type || 'application/octet-stream';

            if (storageProvider === 'local') {
                const filePath = path.resolve(UPLOADS_ROOT, storageKey);

                // Prevent path traversal
                if (!filePath.startsWith(UPLOADS_ROOT)) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_PATH', message: 'Invalid storage path' }
                    });
                }

                if (!fs.existsSync(filePath)) {
                    if (ENABLE_DEV_PLACEHOLDER_DOWNLOAD) {
                        writeDevPlaceholderDocument(filePath, originalFilename, req.params.market_code);
                    } else {
                        return res.status(404).json({
                            success: false,
                            error: {
                                code: 'DOCUMENT_FILE_NOT_FOUND',
                                message: 'Document file not found on storage.'
                            }
                        });
                    }
                }

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
                const stream = fs.createReadStream(filePath);
                return stream.pipe(res);
            }

            // For S3/GCS/Azure: generate signed URL and redirect (placeholder)
            return res.status(501).json({
                success: false,
                error: {
                    code: 'STORAGE_NOT_IMPLEMENTED',
                    message: `Storage provider '${storageProvider}' download not implemented yet`
                }
            });
        } catch (error) {
            console.error('Error downloading document:', error);
            next(error);
        }
    }
);

// =============================================
// 3.5c POST /api/export/markets/:market_code/documents/:document_id/approve
// Approve uploaded document
// =============================================
router.post(
    '/:market_code/documents/:document_id/approve',
    authenticate,
    requireRole('b2b'),
    approveDocumentValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.approveDocument(
                req.companyId,
                req.params.market_code,
                req.params.document_id,
                req.userId
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error approving document:', error);
            next(error);
        }
    }
);

// =============================================
// 3.5d DELETE /api/export/markets/:market_code/documents/:document_id
// Remove document
// =============================================
router.delete(
    '/:market_code/documents/:document_id',
    authenticate,
    requireRole('b2b'),
    documentParamsValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.removeDocument(
                req.companyId,
                req.params.market_code,
                req.params.document_id
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(200).json({
                success: true,
                message: 'Document removed'
            });
        } catch (error) {
            console.error('Error removing document:', error);
            next(error);
        }
    }
);

// =============================================
// 3.6 POST /api/export/markets/:market_code/reports
// Generate compliance report
// =============================================
router.post(
    '/:market_code/reports',
    authenticate,
    requireRole('b2b'),
    generateComplianceReportValidation,
    validate,
    async (req, res, next) => {
        try {
            if (!requireCompany(req, res)) return;

            const result = await exportMarketsService.generateComplianceReport(
                req.companyId,
                req.userId,
                req.params.market_code,
                req.body.file_format
            );

            if (!result.success) {
                return handleServiceError(res, result);
            }

            return res.status(202).json({
                success: true,
                data: result.data
            });
        } catch (error) {
            console.error('Error generating compliance report:', error);
            next(error);
        }
    }
);

module.exports = router;
