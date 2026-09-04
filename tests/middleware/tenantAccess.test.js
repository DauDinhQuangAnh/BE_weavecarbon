const {
  COMPANY_ROLE_PERMISSIONS,
  enforceTenantMutationAccess,
  hasCompanyPermission
} = require('../../src/middleware/tenantAccess');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('tenant RBAC', () => {
  test('publishes the smallest auditable company permission model', () => {
    expect(COMPANY_ROLE_PERMISSIONS).toEqual({
      admin: ['read', 'write', 'manage', 'billing'],
      member: ['read', 'write'],
      viewer: ['read']
    });
    expect(hasCompanyPermission('viewer', 'write')).toBe(false);
    expect(hasCompanyPermission('member', 'write')).toBe(true);
    expect(hasCompanyPermission('admin', 'billing')).toBe(true);
  });

  test('blocks a viewer from mutating tenant resources', () => {
    const req = {
      method: 'PATCH', originalUrl: '/api/products/product-from-company-b',
      companyId: 'company-a', companyRole: 'viewer'
    };
    const res = response();
    const next = jest.fn();

    enforceTenantMutationAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'TENANT_PERMISSION_DENIED' })
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('allows viewer reads and member writes through to scoped repositories', () => {
    for (const req of [
      { method: 'GET', originalUrl: '/api/products/x', companyId: 'company-a', companyRole: 'viewer' },
      { method: 'POST', originalUrl: '/api/evidence', companyId: 'company-a', companyRole: 'member' }
    ]) {
      const next = jest.fn();
      enforceTenantMutationAccess(req, response(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});
