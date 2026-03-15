const express = require('express');
const companyMembersService = require('../services/companyMembersService');
const validate = require('../middleware/validator');
const {
  authenticate,
  requireRole,
  requireCompanyAdmin,
  requireCompanyMember
} = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendNoCompany, sendSuccess } = require('../utils/http');
const {
  createMemberValidation,
  updateMemberValidation,
  deleteMemberValidation,
  getMembersValidation
} = require('../validators/companyMembersValidators');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('b2b'));

router.get(
  '/',
  requireCompanyMember,
  getMembersValidation,
  validate,
  asyncHandler(async (req, res) => {
    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    const filters = {};
    if (req.query.status) {
      filters.status = req.query.status;
    }
    if (req.query.role) {
      filters.role = req.query.role;
    }

    const result = await companyMembersService.getMembers(req.companyId, filters);

    return sendSuccess(res, {
      data: result.members,
      meta: result.meta
    });
  })
);

router.post(
  '/',
  requireCompanyAdmin,
  createMemberValidation,
  validate,
  asyncHandler(async (req, res) => {
    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    const { email, full_name, password, role, send_notification_email } = req.body;

    const member = await companyMembersService.createMember(req.companyId, req.userId, {
      email,
      full_name,
      password,
      role,
      send_notification_email:
        send_notification_email !== undefined ? send_notification_email : true
    });

    return sendSuccess(res, {
      status: 201,
      data: member,
      message: 'Member created successfully. Notification email sent.'
    });
  })
);

router.put(
  '/:id',
  requireCompanyAdmin,
  updateMemberValidation,
  validate,
  asyncHandler(async (req, res) => {
    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    const updateData = {};
    if (req.body.role) {
      updateData.role = req.body.role;
    }
    if (req.body.status) {
      updateData.status = req.body.status;
    }

    const updatedMember = await companyMembersService.updateMember(
      req.companyId,
      req.params.id,
      req.userId,
      updateData
    );

    return sendSuccess(res, {
      data: updatedMember,
      message: 'Member updated successfully'
    });
  })
);

router.delete(
  '/:id',
  requireCompanyAdmin,
  deleteMemberValidation,
  validate,
  asyncHandler(async (req, res) => {
    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    await companyMembersService.deleteMember(req.companyId, req.params.id, req.userId);

    return sendSuccess(res, {
      message: 'Member removed successfully'
    });
  })
);

module.exports = router;
