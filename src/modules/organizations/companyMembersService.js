const { companyMembersRepository } = require('./companyMembersRepository');
const analyticsService = require('../shared/analytics');
const authService = require('../shared/identity');
const emailService = require('../shared/email');
const { createAppError } = require('../shared/errors');
const logger = require('../shared/logger');

function createCompanyMembersService({
  repository = companyMembersRepository,
  analytics = analyticsService,
  identity = authService,
  email = emailService,
  appError = createAppError,
  log = logger
} = {}) {
  const pushAnalyticsEvent = async (transaction, eventIds, payload, scope) => {
    try {
      const event = await analytics.enqueueEvent(transaction, payload);
      if (event?.id) eventIds.push(event.id);
    } catch (error) {
      log.error({ err: error }, `[companyMembersService] Failed to queue ${scope}`);
    }
  };

  return {
    async getMembers(companyId, filters = {}) {
      return repository.withConnection(async (connection) => {
        const members = await repository.listMembers(connection, companyId, filters);
        const meta = await repository.getMemberMeta(connection, companyId);
        return {
          members,
          meta: {
            total: parseInt(meta.total),
            active: parseInt(meta.active),
            invited: parseInt(meta.invited),
            disabled: parseInt(meta.disabled)
          }
        };
      });
    },

    async createMember(companyId, invitedBy, memberData) {
      const { email: rawEmail, full_name, role, send_notification_email, frontend_origin } = memberData;
      const normalizedEmail = String(rawEmail || '').trim().toLowerCase();
      const normalizedFullName = String(full_name || '').trim();
      const analyticsEventIds = [];

      const result = await repository.withTransaction(async (transaction) => {
        const company = await repository.findCompany(transaction, companyId);
        if (!company) {
          throw appError('Company not found', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
        }

        const existingMembership = await repository.findMembershipByEmail(
          transaction,
          companyId,
          normalizedEmail
        );
        if (existingMembership) {
          throw appError('Email already exists in company', {
            statusCode: 409,
            code: 'DUPLICATE_MEMBER_EMAIL'
          });
        }

        const existingUser = await identity.getUserByEmail(normalizedEmail);
        const memberFullName = existingUser?.full_name || normalizedFullName;
        let userId;

        if (existingUser) {
          const existingRoles = Array.isArray(existingUser.roles) ? existingUser.roles : [];
          if (existingRoles.includes('b2c')) {
            throw appError(
              'This email is already registered as a B2C account and cannot be invited as a B2B sub-account.',
              { statusCode: 409, code: 'B2C_EMAIL_NOT_ALLOWED_FOR_B2B' }
            );
          }

          userId = existingUser.id;
          await repository.attachProfileToCompany(transaction, companyId, userId);
          if (!(await repository.hasB2BRole(transaction, userId))) {
            await repository.addB2BRole(transaction, userId);
          }
        } else {
          const created = await identity.createInvitedCompanyUser({
            client: transaction,
            email: normalizedEmail,
            fullName: normalizedFullName,
            companyId
          });
          userId = created.user.id;
        }

        const member = await repository.insertMember(transaction, {
          companyId,
          userId,
          role,
          invitedBy
        });
        await pushAnalyticsEvent(transaction, analyticsEventIds, {
          event_name: 'wc_member_invited',
          user_id: invitedBy,
          company_id: companyId,
          entity_type: 'company_member',
          entity_id: member.id,
          payload: { member_role: role }
        }, 'wc_member_invited');

        return { company, member, memberFullName, userId };
      });

      analytics.queuePendingDispatch(analyticsEventIds);
      if (send_notification_email) {
        const inviteToken = identity.generateCompanyInviteToken({
          email: normalizedEmail,
          companyId
        });
        email.sendCompanyInviteEmail(
          normalizedEmail,
          inviteToken,
          result.memberFullName,
          {
            companyName: result.company.name,
            frontendOrigin: frontend_origin || null
          }
        ).catch((error) => log.error({ err: error }, 'Failed to send company invite email'));
      }

      return {
        id: result.member.id,
        user_id: result.userId,
        email: normalizedEmail,
        full_name: result.memberFullName,
        role: result.member.role,
        status: result.member.status,
        created_at: result.member.created_at
      };
    },

    async resendInvite(companyId, memberId, options = {}) {
      return repository.withConnection(async (connection) => {
        const member = await repository.findInvite(connection, companyId, memberId);
        if (!member) {
          throw appError('Member not found', { statusCode: 404, code: 'MEMBER_NOT_FOUND' });
        }
        if (member.status !== 'invited') {
          throw appError('Invite is only available for pending members', {
            statusCode: 409,
            code: 'INVITE_NOT_PENDING'
          });
        }

        const inviteToken = identity.generateCompanyInviteToken({ email: member.email, companyId });
        const emailSent = await email.sendCompanyInviteEmail(
          member.email,
          inviteToken,
          member.full_name,
          {
            companyName: member.company_name,
            frontendOrigin: options.frontend_origin || null
          }
        );
        if (!emailSent) {
          throw appError('Failed to send invite email', {
            statusCode: 502,
            code: 'INVITE_EMAIL_SEND_FAILED'
          });
        }
        return { id: member.id, email: member.email, email_sent: emailSent };
      });
    },

    async updateMember(companyId, memberId, userId, updateData) {
      const analyticsEventIds = [];
      const updatedMember = await repository.withTransaction(async (transaction) => {
        const targetMember = await repository.findMemberForMutation(
          transaction,
          companyId,
          memberId
        );
        if (!targetMember) {
          throw appError('Member not found', { statusCode: 404, code: 'MEMBER_NOT_FOUND' });
        }
        if (targetMember.user_id === userId) {
          throw appError('Cannot update your own membership', {
            statusCode: 400,
            code: 'CANNOT_UPDATE_SELF'
          });
        }
        if (targetMember.role === 'admin') {
          throw appError('Cannot update admin members', {
            statusCode: 400,
            code: 'ADMIN_MEMBER_PROTECTED'
          });
        }
        if (!updateData.role && !updateData.status) {
          throw appError('No fields to update', {
            statusCode: 400,
            code: 'NO_FIELDS_TO_UPDATE'
          });
        }

        const member = await repository.updateMember(
          transaction,
          companyId,
          memberId,
          updateData
        );
        if (!member) {
          throw appError('Failed to update member', {
            statusCode: 400,
            code: 'MEMBER_UPDATE_FAILED'
          });
        }

        if (updateData.role) {
          await pushAnalyticsEvent(transaction, analyticsEventIds, {
            event_name: 'wc_member_role_changed',
            user_id: userId,
            company_id: companyId,
            entity_type: 'company_member',
            entity_id: memberId,
            payload: {
              previous_role: targetMember.role === 'editor' ? 'member' : targetMember.role,
              next_role: member.role === 'editor' ? 'member' : member.role
            }
          }, 'wc_member_role_changed');
        }
        if (updateData.status) {
          await pushAnalyticsEvent(transaction, analyticsEventIds, {
            event_name: 'wc_member_disabled',
            user_id: userId,
            company_id: companyId,
            entity_type: 'company_member',
            entity_id: memberId,
            payload: {
              member_role: targetMember.role === 'editor' ? 'member' : targetMember.role,
              status: updateData.status
            }
          }, 'wc_member_disabled');
        }
        return member;
      });

      analytics.queuePendingDispatch(analyticsEventIds);
      return updatedMember;
    },

    async deleteMember(companyId, memberId, userId) {
      const analyticsEventIds = [];
      await repository.withTransaction(async (transaction) => {
        const targetMember = await repository.findMemberForMutation(
          transaction,
          companyId,
          memberId
        );
        if (!targetMember) {
          throw appError('Member not found', { statusCode: 404, code: 'MEMBER_NOT_FOUND' });
        }
        if (targetMember.user_id === userId) {
          throw appError('Cannot delete yourself', {
            statusCode: 400,
            code: 'CANNOT_DELETE_SELF'
          });
        }
        if (targetMember.role === 'admin') {
          throw appError('Cannot delete admin members', {
            statusCode: 400,
            code: 'ADMIN_MEMBER_PROTECTED'
          });
        }

        const deleted = await repository.deleteMember(transaction, companyId, memberId);
        if (!deleted) {
          throw appError('Failed to delete member', {
            statusCode: 400,
            code: 'MEMBER_DELETE_FAILED'
          });
        }
        await pushAnalyticsEvent(transaction, analyticsEventIds, {
          event_name: 'wc_member_removed',
          user_id: userId,
          company_id: companyId,
          entity_type: 'company_member',
          entity_id: memberId,
          payload: {
            member_role: targetMember.role === 'editor' ? 'member' : targetMember.role
          }
        }, 'wc_member_removed');
      });

      analytics.queuePendingDispatch(analyticsEventIds);
      return true;
    },

    async isCompanyAdmin(userId, companyId) {
      return repository.withConnection(async (connection) => {
        const role = await repository.findActiveRole(connection, companyId, userId);
        return role === 'admin';
      });
    },

    async isCompanyMember(userId, companyId) {
      return repository.withConnection((connection) => (
        repository.hasActiveMembership(connection, companyId, userId)
      ));
    }
  };
}

module.exports = {
  createCompanyMembersService,
  companyMembersService: createCompanyMembersService()
};
