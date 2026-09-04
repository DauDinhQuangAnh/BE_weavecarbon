const express = require('express');
const { authenticate, requireRole } = require('../shared/security');
const { asyncHandler, sendError, sendSuccess } = require('../shared/http');
const { factorRegistryService } = require('./factorRegistryService');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b', 'admin'));

router.get('/registries', asyncHandler(async (_req, res) => {
  const registries = await factorRegistryService.listRegistries();
  return sendSuccess(res, { data: { registries } });
}));

router.get('/', asyncHandler(async (req, res) => {
  const proxyValue = String(req.query.is_proxy || '').toLowerCase();
  const result = await factorRegistryService.listFactors({
    registryVersion: req.query.registry_version,
    unit: req.query.unit,
    geography: req.query.geography,
    factorClass: req.query.factor_class,
    isProxy: proxyValue === 'true' ? true : proxyValue === 'false' ? false : undefined
  });
  return sendSuccess(res, { data: result });
}));

router.get('/:factorId', asyncHandler(async (req, res) => {
  const factor = await factorRegistryService.getFactor(
    req.params.factorId,
    req.query.registry_version
  );
  if (!factor) {
    return sendError(res, {
      status: 404,
      code: 'FACTOR_NOT_FOUND',
      message: 'Emission factor not found in the requested registry.'
    });
  }
  return sendSuccess(res, { data: factor });
}));

module.exports = router;
