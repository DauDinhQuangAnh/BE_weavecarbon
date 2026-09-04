const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { jobRepository } = require('../operations/jobRepository');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
router.use(authenticate);
router.use(requireRole('b2b'));

router.get('/jobs/:id', asyncHandler(async (req, res) => {
  if (!req.companyId) {
    return sendError(res, { status: 404, code: 'NO_COMPANY', message: 'No company associated with this user' });
  }
  if (!UUID_PATTERN.test(req.params.id)) {
    return sendError(res, { status: 400, code: 'INVALID_JOB_ID', message: 'Invalid operational job ID.' });
  }
  const job = await jobRepository.findForCompany(req.params.id, req.companyId);
  if (!job) {
    return sendError(res, { status: 404, code: 'JOB_NOT_FOUND', message: 'Operational job not found.' });
  }
  return sendSuccess(res, { data: job });
}));

module.exports = router;
