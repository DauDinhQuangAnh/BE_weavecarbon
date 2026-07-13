const subscriptionService = require('../services/subscriptionService');
const { sendError } = require('../utils/http');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PLAN_LOCK_PROTECTED_PREFIXES = [
  '/api/products',
  '/api/product-batches',
  '/api/logistics',
  '/api/reports',
  '/api/company/members',
  '/api/account/company'
];
const TRIAL_PLAN_RESTRICTED_PREFIXES = [
  '/api/reports'
];

function hasAnyRole(userRoles, allowedRoles) {
  return Array.isArray(userRoles) && userRoles.some((role) => allowedRoles.includes(role));
}

function getRequestPath(req) {
  return String(req.originalUrl || req.url || '').toLowerCase();
}

function isB2BCompanyRequest(req) {
  return Boolean(req.companyId) && hasAnyRole(req.userRoles, ['b2b']);
}

/**
 * Enforces subscription plan-lock / trial restrictions for authenticated B2B
 * requests. Must run after `authenticate` has populated req.userId,
 * req.companyId and req.userRoles.
 */
async function enforceSubscriptionAccess(req, res, next) {
  const requestPath = getRequestPath(req);
  const shouldCheckPlanLock =
    isB2BCompanyRequest(req) &&
    MUTATION_METHODS.has(req.method) &&
    PLAN_LOCK_PROTECTED_PREFIXES.some((prefix) => requestPath.startsWith(prefix));

  const shouldCheckTrialPlanRestriction =
    isB2BCompanyRequest(req) &&
    TRIAL_PLAN_RESTRICTED_PREFIXES.some((prefix) => requestPath.startsWith(prefix));

  if (!shouldCheckPlanLock && !shouldCheckTrialPlanRestriction) {
    return next();
  }

  const accessState = await subscriptionService.getAccessControlState(req.companyId);

  if (
    shouldCheckTrialPlanRestriction &&
    String(accessState.current_plan || '').toLowerCase() === 'trial'
  ) {
    return sendError(res, {
      status: 403,
      code: 'PLAN_RESTRICTED',
      message: 'Reports are available from Standard plan.'
    });
  }

  if (accessState.features_locked) {
    return sendError(res, {
      status: 403,
      code: 'PLAN_LOCKED',
      message: 'Trial has expired. Please upgrade to continue.'
    });
  }

  return next();
}

module.exports = { enforceSubscriptionAccess };
