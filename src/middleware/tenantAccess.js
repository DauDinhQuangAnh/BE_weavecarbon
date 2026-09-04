const { sendError } = require('../utils/http');

const COMPANY_ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['read', 'write', 'manage', 'billing']),
  member: Object.freeze(['read', 'write']),
  viewer: Object.freeze(['read'])
});

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TENANT_RESOURCE_PREFIXES = [
  '/api/products',
  '/api/product-batches',
  '/api/logistics',
  '/api/reports',
  '/api/company/members',
  '/api/account/company',
  '/api/export',
  '/api/evidence',
  '/api/carbon-calculations',
  '/api/electricity-invoices',
  '/api/fuel-invoices',
  '/api/suppliers',
  '/api/data-gaps',
  '/api/audit-trail',
  '/api/chat'
];

function hasCompanyPermission(companyRole, permission) {
  return Boolean(COMPANY_ROLE_PERMISSIONS[companyRole]?.includes(permission));
}

function isTenantResourceRequest(req) {
  const requestPath = String(req.originalUrl || req.url || '').toLowerCase();
  return TENANT_RESOURCE_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
}

function enforceTenantMutationAccess(req, res, next) {
  if (!MUTATION_METHODS.has(req.method) || !isTenantResourceRequest(req)) {
    return next();
  }
  if (!req.companyId) {
    return next();
  }
  if (!hasCompanyPermission(req.companyRole, 'write')) {
    return sendError(res, {
      status: 403,
      code: 'TENANT_PERMISSION_DENIED',
      message: 'The active company role does not permit this operation.'
    });
  }
  return next();
}

function requireCompanyPermission(permission) {
  return (req, res, next) => {
    if (!req.companyId || !hasCompanyPermission(req.companyRole, permission)) {
      return sendError(res, {
        status: 403,
        code: 'TENANT_PERMISSION_DENIED',
        message: 'The active company role does not permit this operation.'
      });
    }
    return next();
  };
}

module.exports = {
  COMPANY_ROLE_PERMISSIONS,
  TENANT_RESOURCE_PREFIXES,
  enforceTenantMutationAccess,
  hasCompanyPermission,
  requireCompanyPermission
};
