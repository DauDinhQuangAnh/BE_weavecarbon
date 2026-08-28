const analyticsService = require('../shared/analytics');
const authTokens = require('./tokens');
const logger = require('../shared/logger');
const { resolveFrontendBaseUrl } = require('../shared/urls');
const { clearRefreshTokenCookie, getRefreshTokenFromRequest } = require('../shared/authCookies');


const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 8 * 60 * 60;

const GOOGLE_AUTH_ERROR_MESSAGES = {
  MISSING_CODE: 'Google callback is missing authorization code.',
  INVALID_OAUTH_STATE: 'Google authentication session is invalid or expired. Please retry.',
  GOOGLE_ACCOUNT_NOT_FOUND: 'Google account has not been registered. Please sign up first.',
  GOOGLE_EMAIL_ALREADY_REGISTERED: 'Email already exists. Please use Google sign in instead.',
  GOOGLE_TOKEN_EXCHANGE_FAILED: 'Unable to complete Google authentication. Please retry.',
  GOOGLE_USERINFO_FAILED: 'Unable to fetch Google profile. Please retry.',
  GOOGLE_AUTH_FAILED: 'Google authentication failed. Please retry.'
};

const attachAnalyticsCompany = (company) => {
  if (!company) {
    return null;
  }

  const companyId = company.id || company.company_id || null;
  return {
    ...company,
    analytics_company_key: analyticsService.buildAnalyticsCompanyKey(companyId)
  };
};

const resolveEntryAccountType = ({ role = null, roles = [], companyId = null } = {}) => {
  if (role === 'b2c') return 'b2c';
  if (role === 'b2b') return 'b2b';

  if (Array.isArray(roles)) {
    if (roles.includes('b2c')) return 'b2c';
    if (roles.includes('b2b') || roles.includes('admin')) return 'b2b';
  }

  return companyId ? 'b2b' : 'b2c';
};

const safeTrackAnalyticsEvent = async (payload) => {
  try {
    await analyticsService.trackEvent(payload);
  } catch (error) {
    logger.error({ err: error }, '[auth] Failed to track analytics event');
  }
};

function buildFrontendAuthCallbackUrl(params = {}, preferredFrontendOrigin = null) {
  const frontendUrl = resolveFrontendBaseUrl(preferredFrontendOrigin);
  const callbackPath = `${frontendUrl}/auth/callback`;
  const hash = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return hash ? `${callbackPath}#${hash}` : callbackPath;
}

function buildFrontendLoginUrl(preferredFrontendOrigin = null, options = {}) {
  const frontendUrl = resolveFrontendBaseUrl(preferredFrontendOrigin);
  const url = new URL('/auth', frontendUrl);

  if (options.accountType) {
    url.searchParams.set('type', options.accountType);
  }

  if (options.email) {
    url.searchParams.set('email', options.email);
  }

  return url.toString();
}

function resolveRequestedFrontendOrigin(req) {
  return (
    req.query?.frontend_origin ||
    req.query?.frontendOrigin ||
    req.body?.frontend_origin ||
    req.body?.frontendOrigin ||
    req.get('origin') ||
    null
  );
}

function resolvePostAuthNextStep(user, companyIdForToken) {
  const isB2B = Array.isArray(user?.roles) && user.roles.includes('b2b');
  const requiresCompanySetup = isB2B && !companyIdForToken;
  return {
    requiresCompanySetup,
    nextStep: requiresCompanySetup ? 'company_onboarding' : 'dashboard'
  };
}

function normalizeRefreshTokenValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveRefreshTokenValue(req) {
  return (
    normalizeRefreshTokenValue(getRefreshTokenFromRequest(req)) ||
    normalizeRefreshTokenValue(req.body?.refresh_token)
  );
}

function extractBearerAccessToken(req) {
  const authorization = String(req.get('authorization') || '');
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return normalizeRefreshTokenValue(authorization.slice(7));
}

function resolveRequestMetadata(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ipAddress = String(forwardedIp || req.ip || req.socket?.remoteAddress || '').trim() || null;
  const userAgent = String(req.get('user-agent') || '').trim() || null;

  return {
    ipAddress,
    userAgent
  };
}

function buildTokenPayload(accessToken, refreshToken, { includeRefreshToken = true } = {}) {
  const decodedExpiry = authTokens.decodeJwtExpiry(accessToken);
  const expiresAtDate =
    decodedExpiry instanceof Date && !Number.isNaN(decodedExpiry.getTime()) ?
      decodedExpiry :
      new Date(Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000);
  const expiresIn = Math.max(
    0,
    Math.floor((expiresAtDate.getTime() - Date.now()) / 1000)
  );
  const tokens = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    expires_at: expiresAtDate.toISOString()
  };

  if (includeRefreshToken && refreshToken) {
    tokens.refresh_token = refreshToken;
  }

  return tokens;
}

function buildAuthResponseData({
  user,
  company,
  companyMembership,
  companyIdForToken,
  accessToken,
  refreshToken,
  includeRefreshToken = false
}) {
  const analyticsIdentity = analyticsService.getAnalyticsIdentity({
    userId: user.id,
    companyId: companyIdForToken
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      email_verified: user.email_verified,
      avatar_url: user.avatar_url || null
    },
    profile: {
      id: user.profile_id,
      company_id: companyIdForToken || user.company_id || null,
      is_demo_user: user.is_demo_user
    },
    roles: user.roles,
    company: attachAnalyticsCompany(company),
    company_membership: companyMembership,
    analytics_user_key: analyticsIdentity.analytics_user_key,
    tokens: buildTokenPayload(accessToken, refreshToken, { includeRefreshToken })
  };
}

function sendSessionExpired(res, message = 'Session expired. Please sign in again.', {
  code = 'SESSION_EXPIRED',
  clearCookie = true
} = {}) {
  if (clearCookie) {
    clearRefreshTokenCookie(res);
  }
  return res.status(401).json({
    success: false,
    error: {
      code,
      message
    }
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prefersHtmlResponse(req) {
  const accept = String(req.get('accept') || '').toLowerCase();
  const view = String(req.query.view || '').toLowerCase();
  return view === 'html' || view === 'page' || accept.includes('text/html');
}

function buildVerificationResultPage({
  status = 'success',
  title,
  message,
  details,
  actionUrl,
  actionLabel
}) {
  const isSuccess = status === 'success';
  const accent = isSuccess ? '#16a34a' : '#dc2626';
  const pillBackground = isSuccess ? '#dcfce7' : '#fee2e2';
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeDetails = escapeHtml(details);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeActionLabel = escapeHtml(actionLabel);
  const statusLabel = isSuccess ? 'Verification completed' : 'Verification failed';
  const iconPath = isSuccess
    ? '<path d="M8 20L14 26L28 12" stroke="#16a34a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />'
    : '<path d="M11 11L25 25M25 11L11 25" stroke="#dc2626" stroke-width="3.2" stroke-linecap="round" />';

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
        <style>
          :root {
            color-scheme: light;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background: radial-gradient(circle at 15% 20%, #e0f2fe 0%, #f8fafc 45%, #dcfce7 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #0f172a;
          }
          .card {
            width: min(560px, 100%);
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            padding: 32px 28px;
            box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
            text-align: center;
          }
          .status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 18px;
            padding: 8px 14px;
            border-radius: 999px;
            background: ${pillBackground};
            color: ${accent};
            font-size: 13px;
            font-weight: 700;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 30px;
            line-height: 1.2;
            letter-spacing: -0.02em;
          }
          p {
            margin: 0;
            font-size: 16px;
            line-height: 1.7;
            color: #334155;
          }
          .details {
            margin-top: 12px;
            font-size: 14px;
            color: #64748b;
          }
          .button {
            display: inline-block;
            margin-top: 24px;
            text-decoration: none;
            background: ${accent};
            color: #ffffff;
            border-radius: 12px;
            padding: 12px 24px;
            font-size: 15px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="status">
            <svg width="18" height="18" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <circle cx="18" cy="18" r="17" fill="#ffffff" stroke="${accent}" stroke-width="2" />
              ${iconPath}
            </svg>
            <span>${statusLabel}</span>
          </div>
          <h1>${safeTitle}</h1>
          <p>${safeMessage}</p>
          <p class="details">${safeDetails}</p>
          ${actionUrl && actionLabel ? `<a class="button" href="${safeActionUrl}">${safeActionLabel}</a>` : ''}
        </main>
      </body>
    </html>
  `;
}


module.exports = {
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  GOOGLE_AUTH_ERROR_MESSAGES,
  attachAnalyticsCompany,
  resolveEntryAccountType,
  safeTrackAnalyticsEvent,
  buildFrontendAuthCallbackUrl,
  buildFrontendLoginUrl,
  resolveRequestedFrontendOrigin,
  resolvePostAuthNextStep,
  normalizeRefreshTokenValue,
  resolveRefreshTokenValue,
  extractBearerAccessToken,
  resolveRequestMetadata,
  buildTokenPayload,
  buildAuthResponseData,
  sendSessionExpired,
  escapeHtml,
  prefersHtmlResponse,
  buildVerificationResultPage
};


