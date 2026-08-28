const express = require('express');
const { companyMembersService } = require('./companyMembersService');
const validate = require('../shared/validation');
const {
  authenticate,
  requireRole,
  requireCompanyAdmin,
  requireCompanyMember
} = require('../shared/security');
const { asyncHandler, sendNoCompany, sendSuccess } = require('../shared/http');
const {
  createMemberValidation,
  updateMemberValidation,
  deleteMemberValidation,
  getMembersValidation,
  resendInviteValidation
} = require('./companyMembersValidators');

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
    if (req.query.status) filters.status = req.query.status;
    if (req.query.role) filters.role = req.query.role;

    const result = await companyMembersService.getMembers(req.companyId, filters);
    return sendSuccess(res, { data: result.members, meta: result.meta });
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

    const { email, full_name, role, send_notification_email, frontend_origin } = req.body;
    const member = await companyMembersService.createMember(req.companyId, req.userId, {
      email,
      full_name,
      role,
      frontend_origin,
      send_notification_email:
        send_notification_email !== undefined ? send_notification_email : true
    });

    return sendSuccess(res, {
      status: 201,
      data: member,
      message: 'Member invited successfully'
    });
  })
);

router.post(
  '/:id/resend-invite',
  requireCompanyAdmin,
  resendInviteValidation,
  validate,
  asyncHandler(async (req, res) => {
    if (!req.companyId) {
      return sendNoCompany(res, 'User does not belong to a company', 400);
    }

    const result = await companyMembersService.resendInvite(req.companyId, req.params.id, {
      frontend_origin: req.body?.frontend_origin
    });
    return sendSuccess(res, {
      data: result,
      message: 'Invite email resent successfully'
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
    if (req.body.role) updateData.role = req.body.role;
    if (req.body.status) updateData.status = req.body.status;

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
    return sendSuccess(res, { message: 'Member removed successfully' });
  })
);

module.exports = router;
