const pool = require('../config/database');
const {
  tokens: authTokens,
  refreshSessionService,
  accountProvisioningService,
  verificationService,
  googleAccountService,
  demoAccountService
} = require('../modules/auth');

class AuthService {
  async ensureRefreshTokenSchema(client = pool) {
    return refreshSessionService.ensureSchema(client);
  }

  async createRefreshTokenSchema(client) {
    return refreshSessionService.createSchema(client);
  }

  hashRefreshToken(token) {
    return authTokens.hashRefreshToken(token);
  }

  decodeJwtExpiry(token) {
    return authTokens.decodeJwtExpiry(token);
  }

  async initializeTrial(client, companyId) {
    return accountProvisioningService.initializeTrial(client, companyId);
  }

  async initializeStandardDemo(client, companyId, standardSkuLimit = 20) {
    return demoAccountService.initializeStandardDemo(client, companyId, standardSkuLimit);
  }

  async hashPassword(password) {
    return authTokens.hashPassword(password);
  }

  async verifyPassword(password, hashedPassword) {
    return authTokens.verifyPassword(password, hashedPassword);
  }

  generateSystemPassword(length = 20) {
    return authTokens.generateSystemPassword(length);
  }

  generateAccessToken(userId, email, roles, companyId = null, isDemo = false) {
    return authTokens.generateAccessToken(userId, email, roles, companyId, isDemo);
  }

  generateRefreshToken(userId, rememberMe = true) {
    return authTokens.generateRefreshToken(userId, rememberMe);
  }

  generateCompanyInviteToken({ email, companyId }) {
    return authTokens.generateCompanyInviteToken({ email, companyId });
  }

  verifyAccessToken(token) {
    return authTokens.verifyAccessToken(token);
  }

  verifyRefreshToken(token) {
    return authTokens.verifyRefreshToken(token);
  }

  verifyCompanyInviteToken(token) {
    return authTokens.verifyCompanyInviteToken(token);
  }

  async storeRefreshToken(refreshToken, userId, metadata = {}) {
    return refreshSessionService.store(refreshToken, userId, metadata);
  }

  async getRefreshTokenRecord(refreshToken, client = pool) {
    return refreshSessionService.getRecord(refreshToken, client);
  }

  async isRefreshTokenActive(refreshToken, client = pool) {
    return refreshSessionService.isActive(refreshToken, client);
  }

  async revokeRefreshToken(refreshToken, client = pool) {
    return refreshSessionService.revoke(refreshToken, client);
  }

  async revokeAllRefreshTokens(userId, client = pool) {
    return refreshSessionService.revokeAll(userId, client);
  }

  async rotateRefreshToken(currentRefreshToken, nextRefreshToken, metadata = {}) {
    return refreshSessionService.rotate(currentRefreshToken, nextRefreshToken, metadata);
  }

  generateVerificationToken(email) {
    return authTokens.generateVerificationToken(email);
  }

  verifyEmailToken(token) {
    return authTokens.verifyEmailToken(token);
  }

  async createInvitedCompanyUser({ client, email, fullName, companyId }) {
    return accountProvisioningService.createInvitedCompanyUser({
      client,
      email,
      fullName,
      companyId
    });
  }

  async createUser(email, password, fullName, role, companyData = null) {
    return accountProvisioningService.createUser(email, password, fullName, role, companyData);
  }

  async createOrUpdateGoogleUser(email, fullName, avatarUrl, role = 'b2c', options = {}) {
    return googleAccountService.createOrUpdateGoogleUser(
      email,
      fullName,
      avatarUrl,
      role,
      options
    );
  }

  async handleGoogleAuth({
    email,
    fullName,
    avatarUrl,
    role = 'b2c',
    intent = 'signin'
  }) {
    return googleAccountService.handleGoogleAuth({ email, fullName, avatarUrl, role, intent });
  }

  async resolveCompanyIdForToken(userId, fallbackCompanyId = null) {
    return verificationService.resolveCompanyIdForToken(userId, fallbackCompanyId);
  }

  async markUserLoggedIn(userId) {
    return verificationService.markUserLoggedIn(userId);
  }

  async getUserByEmail(email) {
    return accountProvisioningService.getUserByEmail(email);
  }

  async getUserById(userId) {
    return accountProvisioningService.getUserById(userId);
  }

  async markEmailVerified(userId) {
    return verificationService.markEmailVerified(userId);
  }

  async getCompanyMembership(companyId, userId, client = pool) {
    return verificationService.getCompanyMembership(companyId, userId, client);
  }

  async activateCompanyMembership(companyId, userId, client = pool) {
    return verificationService.activateCompanyMembership(companyId, userId, client);
  }

  async seedDemoB2CData(client, userId) {
    return demoAccountService.seedDemoB2CData(client, userId);
  }

  async createDemoUser(role, scenario = 'sample_data') {
    return demoAccountService.createDemoUser(role, scenario);
  }

  async getPrimaryCompanyMembership(userId, options = {}) {
    return accountProvisioningService.getPrimaryCompanyMembership(userId, options);
  }
}

module.exports = new AuthService();
