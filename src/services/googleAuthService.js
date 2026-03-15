const axios = require('axios');
const crypto = require('crypto');

class GoogleAuthService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
    this.stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'google-oauth-state-secret';
    this.stateTtlMs = 10 * 60 * 1000; // 10 minutes
  }

  normalizeFrontendOrigin(origin) {
    const raw = String(origin || '').trim();
    if (!raw) return null;

    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  }

  normalizeRole(role = 'b2c') {
    const validRoles = new Set(['b2b', 'b2c']);
    return validRoles.has(role) ? role : 'b2c';
  }

  normalizeIntent(intent = 'signin') {
    const validIntents = new Set(['signin', 'signup']);
    return validIntents.has(intent) ? intent : 'signin';
  }

  encodeBase64Url(value) {
    return Buffer.from(value).toString('base64url');
  }

  decodeBase64Url(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
  }

  signState(payloadEncoded) {
    return crypto
      .createHmac('sha256', this.stateSecret)
      .update(payloadEncoded)
      .digest('base64url');
  }

  generateState(role = 'b2c', intent = 'signin', frontendOrigin = null) {
    const payload = {
      role: this.normalizeRole(role),
      intent: this.normalizeIntent(intent),
      frontendOrigin: this.normalizeFrontendOrigin(frontendOrigin),
      iat: Date.now(),
      nonce: crypto.randomBytes(12).toString('hex')
    };

    const payloadEncoded = this.encodeBase64Url(JSON.stringify(payload));
    const signature = this.signState(payloadEncoded);
    return `${payloadEncoded}.${signature}`;
  }

  parseState(state) {
    const fallback = { valid: false, role: 'b2c', intent: 'signin', reason: 'invalid_state' };
    if (!state || typeof state !== 'string') {
      return { ...fallback, reason: 'missing_state' };
    }

    const [payloadEncoded, signature] = state.split('.');
    if (!payloadEncoded || !signature) {
      return fallback;
    }

    const expectedSignature = this.signState(payloadEncoded);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { ...fallback, reason: 'invalid_signature' };
    }

    try {
      const payload = JSON.parse(this.decodeBase64Url(payloadEncoded));
      const issuedAt = Number(payload.iat);

      if (!issuedAt || Number.isNaN(issuedAt)) {
        return { ...fallback, reason: 'invalid_iat' };
      }

      if (Date.now() - issuedAt > this.stateTtlMs) {
        return { ...fallback, reason: 'expired_state' };
      }

      return {
        valid: true,
        role: this.normalizeRole(payload.role),
        intent: this.normalizeIntent(payload.intent),
        frontendOrigin: this.normalizeFrontendOrigin(payload.frontendOrigin)
      };
    } catch (error) {
      return fallback;
    }
  }

  // Generate Google OAuth URL
  getGoogleAuthUrl(options = {}) {
    const role = typeof options === 'string' ? options : options.role || 'b2c';
    const intent = typeof options === 'string' ? 'signin' : options.intent || 'signin';
    const frontendOrigin = typeof options === 'string' ? null : options.frontendOrigin;
    const state = this.generateState(role, intent, frontendOrigin);
    const scope = encodeURIComponent('email profile');

    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=select_account&state=${encodeURIComponent(state)}`;
  }

  // Exchange code for access token
  async getGoogleTokens(code) {
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      });

      return response.data;
    } catch (error) {
      const wrapped = new Error('Failed to exchange authorization code');
      wrapped.code = 'GOOGLE_TOKEN_EXCHANGE_FAILED';
      wrapped.statusCode = 502;
      wrapped.details = error.response?.data || error.message;
      throw wrapped;
    }
  }

  // Get user info from Google
  async getGoogleUserInfo(accessToken) {
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      return response.data;
    } catch (error) {
      const wrapped = new Error('Failed to fetch user information from Google');
      wrapped.code = 'GOOGLE_USERINFO_FAILED';
      wrapped.statusCode = 502;
      wrapped.details = error.response?.data || error.message;
      throw wrapped;
    }
  }
}

module.exports = new GoogleAuthService();
