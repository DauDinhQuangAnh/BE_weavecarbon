const authService = require('../services/authService');
const companyMembersService = require('../services/companyMembersService');
const { enforceSubscriptionAccess } = require('./subscriptionAccess');
const { sendError } = require('../utils/http');
const logger = require('../utils/logger');

function hasAnyRole(userRoles, allowedRoles) {
  return Array.isArray(userRoles) && userRoles.some((role) => allowedRoles.includes(role));
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7);
}

function assignRequestUserContext(req, user, companyId) {
  const userRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
  const resolvedCompanyId = companyId || null;

  req.user = {
    ...user,
    user_id: user.id,
    company_id: resolvedCompanyId
  };
  req.userId = user.id;
  req.userRoles = userRoles;
  req.companyId = resolvedCompanyId;
}

async function resolveCompanyId(user, decodedCompanyId) {
  if (decodedCompanyId || user.company_id) {
    return decodedCompanyId || user.company_id;
  }

  if (!hasAnyRole(user.roles, ['b2b', 'admin'])) {
    return null;
  }

  const membership = await authService.getPrimaryCompanyMembership(user.id);
  return membership?.company_id || null;
}

async function hydrateRequestUser(req, decoded) {
  const user = await authService.getUserById(decoded.sub);
  if (!user) {
    return null;
  }

  const companyId = await resolveCompanyId(user, decoded.company_id);
  assignRequestUserContext(req, user, companyId);
  return req.user;
}

function ensureAuthenticatedContext(req, res, companyResponse) {
  if (!req.userId) {
    sendError(res, {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required'
    });
    return false;
  }

  if (companyResponse && !req.companyId) {
    sendError(res, companyResponse);
    return false;
  }

  return true;
}

function createCompanyAccessGuard({ checker, deniedMessage, logLabel, companyResponse }) {
  return async (req, res, next) => {
    try {
      if (!ensureAuthenticatedContext(req, res, companyResponse)) {
        return;
      }

      const hasAccess = await checker(req.userId, req.companyId);
      if (!hasAccess) {
        return sendError(res, {
          status: 403,
          code: 'FORBIDDEN',
          message: deniedMessage
        });
      }

      next();
    } catch (error) {
      logger.error({ err: error }, `${logLabel} error`);
      return sendError(res, {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Authorization check failed'
      });
    }
  };
}

const authenticate = async (req, res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return sendError(res, {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'No token provided'
      });
    }

    const decoded = authService.verifyAccessToken(token);
    if (!decoded) {
      return sendError(res, {
        status: 401,
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      });
    }

    const user = await hydrateRequestUser(req, decoded);
    if (!user) {
      return sendError(res, {
        status: 401,
        code: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    return enforceSubscriptionAccess(req, res, next);
  } catch (error) {
    logger.error({ err: error }, 'Auth middleware error');
    return sendError(res, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Authentication failed'
    });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!hasAnyRole(req.userRoles, roles)) {
    return sendError(res, {
      status: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient permissions'
    });
  }

  next();
};

const optionalAuth = async (req, _res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return next();
    }

    const decoded = authService.verifyAccessToken(token);
    if (!decoded) {
      return next();
    }

    await hydrateRequestUser(req, decoded);
    return next();
  } catch (error) {
    return next();
  }
};

const requireCompanyAdmin = createCompanyAccessGuard({
  checker: companyMembersService.isCompanyAdmin.bind(companyMembersService),
  deniedMessage: 'Company admin role required',
  logLabel: 'Company admin check',
  companyResponse: {
    status: 404,
    code: 'COMPANY_NOT_FOUND',
    message: 'No company associated with this user'
  }
});

const requireCompanyMember = createCompanyAccessGuard({
  checker: companyMembersService.isCompanyMember.bind(companyMembersService),
  deniedMessage: 'Company membership required',
  logLabel: 'Company member check',
  companyResponse: {
    status: 404,
    code: 'COMPANY_NOT_FOUND',
    message: 'No company associated with this user'
  }
});

const requireCompanyRoot = createCompanyAccessGuard({
  checker: companyMembersService.isCompanyAdmin.bind(companyMembersService),
  deniedMessage: 'Company root role required',
  logLabel: 'Company root check',
  companyResponse: {
    status: 404,
    code: 'COMPANY_NOT_FOUND',
    message: 'No company associated with this user'
  }
});

module.exports = {
  authenticate,
  requireRole,
  optionalAuth,
  requireCompanyAdmin,
  requireCompanyMember,
  requireCompanyRoot
};
