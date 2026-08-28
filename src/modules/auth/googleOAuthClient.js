const axios = require('axios');
const crypto = require('crypto');

class GoogleOAuthClient {
  constructor({
    httpClient = axios,
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    redirectUri = process.env.GOOGLE_REDIRECT_URI,
    stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET ||
      process.env.JWT_SECRET ||
      'google-oauth-state-secret',
    stateTtlMs = 10 * 60 * 1000,
    now = () => Date.now(),
    randomBytes = (size) => crypto.randomBytes(size)
  } = {}) {
    this.httpClient = httpClient;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.stateSecret = stateSecret;
    this.stateTtlMs = stateTtlMs;
    this.now = now;
    this.randomBytes = randomBytes;
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
    return new Set(['b2b', 'b2c']).has(role) ? role : 'b2c';
  }

  normalizeIntent(intent = 'signin') {
    return new Set(['signin', 'signup']).has(intent) ? intent : 'signin';
  }

  normalizeRememberMe(rememberMe = true) {
    if (typeof rememberMe === 'boolean') return rememberMe;
    const normalized = String(rememberMe || '').trim().toLowerCase();
    if (!normalized) return true;
    return !['0', 'false', 'no', 'off'].includes(normalized);
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

  generateState(role = 'b2c', intent = 'signin', frontendOrigin = null, rememberMe = true) {
    const payload = {
      role: this.normalizeRole(role),
      intent: this.normalizeIntent(intent),
      frontendOrigin: this.normalizeFrontendOrigin(frontendOrigin),
      rememberMe: this.normalizeRememberMe(rememberMe),
      iat: this.now(),
      nonce: this.randomBytes(12).toString('hex')
    };
    const payloadEncoded = this.encodeBase64Url(JSON.stringify(payload));
    return `${payloadEncoded}.${this.signState(payloadEncoded)}`;
  }

  parseState(state) {
    const fallback = {
      valid: false,
      role: 'b2c',
      intent: 'signin',
      rememberMe: true,
      reason: 'invalid_state'
    };
    if (!state || typeof state !== 'string') return { ...fallback, reason: 'missing_state' };

    const [payloadEncoded, signature] = state.split('.');
    if (!payloadEncoded || !signature) return fallback;

    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(this.signState(payloadEncoded));
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
      if (this.now() - issuedAt > this.stateTtlMs) {
        return { ...fallback, reason: 'expired_state' };
      }
      return {
        valid: true,
        role: this.normalizeRole(payload.role),
        intent: this.normalizeIntent(payload.intent),
        frontendOrigin: this.normalizeFrontendOrigin(payload.frontendOrigin),
        rememberMe: this.normalizeRememberMe(payload.rememberMe)
      };
    } catch {
      return fallback;
    }
  }

  getGoogleAuthUrl(options = {}) {
    const role = typeof options === 'string' ? options : options.role || 'b2c';
    const intent = typeof options === 'string' ? 'signin' : options.intent || 'signin';
    const frontendOrigin = typeof options === 'string' ? null : options.frontendOrigin;
    const rememberMe = typeof options === 'string' ? true : options.rememberMe;
    const state = this.generateState(role, intent, frontendOrigin, rememberMe);
    const scope = encodeURIComponent('email profile');
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&response_type=code&scope=${scope}&access_type=offline&prompt=select_account` +
      `&state=${encodeURIComponent(state)}`;
  }

  async getGoogleTokens(code) {
    try {
      const response = await this.httpClient.post('https://oauth2.googleapis.com/token', {
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

  async getGoogleUserInfo(accessToken) {
    try {
      const response = await this.httpClient.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
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

module.exports = {
  GoogleOAuthClient,
  googleOAuthClient: new GoogleOAuthClient()
};
