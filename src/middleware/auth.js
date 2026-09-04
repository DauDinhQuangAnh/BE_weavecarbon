const authService = require('../services/authService');
const companyMembersService = require('../services/companyMembersService');
const { enforceSubscriptionAccess } = require('./subscriptionAccess');
const { sendError } = require('../utils/http');
const logger = require('../utils/logger');
const { enforceTenantMutationAccess } = require('./tenantAccess');

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

function assignRequestUserContext(req, user, companyContext) {
  const userRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
  const resolvedCompanyId = companyContext?.companyId || null;

  req.user = {
    ...user,
    user_id: user.id,
    company_id: resolvedCompanyId
  };
  req.userId = user.id;
  req.userRoles = userRoles;
  req.companyId = resolvedCompanyId;
  req.companyRole = companyContext?.companyRole || null;
  req.companyMembershipStatus = companyContext?.status || null;
}

async function resolveCompanyContext(user, decodedCompanyId) {
  if (!hasAnyRole(user.roles, ['b2b', 'admin'])) {
    return null;
  }

  if (decodedCompanyId) {
    const selected = await authService.getCompanyMembership(decodedCompanyId, user.id);
    if (selected?.status !== 'active') return null;
    return {
      companyId: selected.company_id,
      companyRole: selected.role,
      status: selected.status
    };
  }

  const membership = await authService.getPrimaryCompanyMembership(user.id);
  if (!membership || membership.member_status !== 'active') return null;
  return {
    companyId: membership.company_id,
    companyRole: membership.company_role,
    status: membership.member_status
  };
}

async function hydrateRequestUser(req, decoded) {
  const user = await authService.getUserById(decoded.sub);
  if (!user) {
    return null;
  }

  const companyContext = await resolveCompanyContext(user, decoded.company_id);
  assignRequestUserContext(req, user, companyContext);
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

    return enforceTenantMutationAccess(req, res, () => enforceSubscriptionAccess(req, res, next));
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

const requirePlatformAdmin = requireRole('admin');

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
  requirePlatformAdmin,
  optionalAuth,
  requireCompanyAdmin,
  requireCompanyMember,
  requireCompanyRoot
};
