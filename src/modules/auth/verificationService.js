const tokens = require('./tokens');
const { accountProvisioningService } = require('./accountProvisioningService');
const { verificationRepository } = require('./verificationRepository');
const emailService = require('../shared/email');
const { createAppError } = require('../shared/errors');

function createVerificationService({
  tokenService = tokens,
  accounts = accountProvisioningService,
  repository = verificationRepository,
  email = emailService,
  appError = createAppError
} = {}) {
  const fail = (message, statusCode, code) => {
    throw appError(message, { statusCode, code });
  };

  const resolveCompanyIdForToken = async (userId, fallbackCompanyId = null) => {
    const membership = await accounts.getPrimaryCompanyMembership(userId);
    return membership?.company_id || fallbackCompanyId || null;
  };

  return {
    async verifyEmail({ token, emailAddress, normalizeEmail = true, alreadyVerified = 'success' }) {
      if (!token || !emailAddress) fail('Token and email are required', 400, 'MISSING_PARAMETERS');

      const requestedEmail = normalizeEmail ?
        String(emailAddress).trim().toLowerCase() :
        emailAddress;
      const decoded = tokenService.verifyEmailToken(token);
      const tokenEmail = normalizeEmail ?
        String(decoded?.email || '').toLowerCase() :
        decoded?.email;

      if (!decoded || decoded.type !== 'email_verification' || tokenEmail !== requestedEmail) {
        fail('Invalid or expired verification token', 400, 'INVALID_VERIFICATION_TOKEN');
      }

      const user = await accounts.getUserByEmail(requestedEmail);
      if (!user) fail('User not found', 404, 'USER_NOT_FOUND');
      if (user.email_verified) {
        if (alreadyVerified === 'error') fail('Email already verified', 400, 'ALREADY_VERIFIED');
        return { alreadyVerified: true, user, companyIdForToken: null };
      }

      await repository.markEmailVerified(user.id);
      const companyIdForToken = await resolveCompanyIdForToken(user.id, user.company_id);
      return { alreadyVerified: false, user, companyIdForToken };
    },

    async resendVerification(emailAddress, { frontendOrigin = null } = {}) {
      if (!emailAddress) fail('Email is required', 400, 'VALIDATION_ERROR');

      const user = await accounts.getUserByEmail(emailAddress);
      if (!user) return { sent: false, hidden: true };
      if (user.email_verified) fail('Email already verified', 400, 'ALREADY_VERIFIED');

      const verificationToken = tokenService.generateVerificationToken(emailAddress);
      await email.sendVerificationEmail(
        emailAddress,
        verificationToken,
        user.full_name,
        null,
        { frontendOrigin }
      );
      return { sent: true, hidden: false };
    },

    async acceptCompanyInvite(token, { onBeforeActivation } = {}) {
      if (!token) fail('Invite token is required', 400, 'MISSING_PARAMETERS');

      const decoded = tokenService.verifyCompanyInviteToken(token);
      const normalizedEmail = String(decoded?.email || '').trim().toLowerCase();
      const companyId = String(decoded?.company_id || '').trim();
      if (!decoded || decoded.type !== 'company_invite' || !normalizedEmail || !companyId) {
        fail('Invalid or expired invite token', 400, 'INVALID_INVITE_TOKEN');
      }

      const user = await accounts.getUserByEmail(normalizedEmail);
      if (!user) fail('User not found', 404, 'USER_NOT_FOUND');

      const membership = await repository.findCompanyMembership(companyId, user.id);
      if (!membership) fail('Invite not found', 404, 'INVITE_NOT_FOUND');
      if (membership.status === 'disabled') {
        fail('This invite is no longer active', 403, 'INVITE_DISABLED');
      }

      if (!user.email_verified) await repository.markEmailVerified(user.id);
      if (onBeforeActivation) await onBeforeActivation();
      await repository.activateCompanyMembership(companyId, user.id);
      await repository.markMembershipLoggedIn(companyId, user.id);
      await repository.markUserLoggedIn(user.id);

      const refreshedUser = await accounts.getUserById(user.id);
      return { companyId, user: refreshedUser || user };
    },

    resolveCompanyIdForToken,
    markEmailVerified(userId) {
      return repository.markEmailVerified(userId);
    },
    getCompanyMembership(companyId, userId, client) {
      return repository.findCompanyMembership(
        companyId,
        userId,
        client || repository.defaultClient
      );
    },
    activateCompanyMembership(companyId, userId, client) {
      return repository.activateCompanyMembership(
        companyId,
        userId,
        client || repository.defaultClient
      );
    },
    markUserLoggedIn(userId) {
      return repository.markUserLoggedIn(userId);
    }
  };
}

module.exports = {
  createVerificationService,
  verificationService: createVerificationService()
};
