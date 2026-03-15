const express = require('express');
const accountService = require('../services/accountService');
const validate = require('../middleware/validator');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendNoCompany, sendSuccess } = require('../utils/http');
const {
  createCompanyValidation,
  updateProfileValidation,
  updateCompanyValidation,
  changePasswordValidation
} = require('../validators/accountValidators');

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const accountInfo = await accountService.getAccountInfo(req.userId);

  return sendSuccess(res, {
    data: accountInfo
  });
}));

router.put('/profile', updateProfileValidation, validate, asyncHandler(async (req, res) => {
  const { full_name, email } = req.body;

  const updatedProfile = await accountService.updateProfile(req.userId, {
    full_name,
    email
  });

  return sendSuccess(res, {
    data: updatedProfile,
    message: 'Profile updated successfully'
  });
}));

router.post('/company', createCompanyValidation, validate, asyncHandler(async (req, res) => {
  const { name, business_type, domestic_market, target_markets } = req.body;
  const accountInfo = await accountService.getAccountInfo(req.userId);

  if (accountInfo.company) {
    return sendError(res, {
      status: 400,
      code: 'ALREADY_HAS_COMPANY',
      message: 'User already has a company. Use PUT /api/account/company to update it.'
    });
  }

  const company = await accountService.createCompany(req.userId, {
    name,
    business_type,
    domestic_market,
    target_markets
  });

  return sendSuccess(res, {
    status: 201,
    data: company,
    message: 'Company created successfully'
  });
}));

router.put(
  '/company',
  requireRole('b2b'),
  requireCompanyAdmin,
  updateCompanyValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { name, business_type, domestic_market, target_markets } = req.body;

    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    const updatedCompany = await accountService.updateCompany(req.userId, req.companyId, {
      name,
      business_type,
      domestic_market,
      target_markets
    });

    return sendSuccess(res, {
      data: updatedCompany,
      message: 'Company updated successfully'
    });
  })
);

router.post(
  '/change-password',
  changePasswordValidation,
  validate,
  asyncHandler(async (req, res) => {
    await accountService.changePassword(req.userId, req.body.new_password);

    return sendSuccess(res, {
      message: 'Password changed successfully'
    });
  })
);

module.exports = router;
