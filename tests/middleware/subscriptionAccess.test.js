jest.mock('../../src/services/subscriptionService');

const subscriptionService = require('../../src/services/subscriptionService');
const { enforceSubscriptionAccess } = require('../../src/middleware/subscriptionAccess');

function createRes() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
}

describe('enforceSubscriptionAccess', () => {
    it('skips the subscription lookup entirely for non-B2B requests', async () => {
        const req = { method: 'POST', originalUrl: '/api/products', companyId: null, userRoles: [] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(subscriptionService.getAccessControlState).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('skips the subscription lookup for B2B requests outside protected prefixes/methods', async () => {
        const req = { method: 'GET', originalUrl: '/api/overview', companyId: 'c1', userRoles: ['b2b'] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(subscriptionService.getAccessControlState).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('blocks a plan-locked B2B mutation on a protected prefix', async () => {
        subscriptionService.getAccessControlState.mockResolvedValue({
            current_plan: 'standard',
            features_locked: true
        });
        const req = { method: 'POST', originalUrl: '/api/products', companyId: 'c1', userRoles: ['b2b'] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(subscriptionService.getAccessControlState).toHaveBeenCalledWith('c1');
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'PLAN_LOCKED' }) })
        );
    });

    it('allows a B2B mutation on a protected prefix when the plan is not locked', async () => {
        subscriptionService.getAccessControlState.mockResolvedValue({
            current_plan: 'standard',
            features_locked: false
        });
        const req = { method: 'PUT', originalUrl: '/api/logistics/shipments/1', companyId: 'c1', userRoles: ['b2b'] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('blocks trial-plan access to restricted prefixes regardless of HTTP method', async () => {
        subscriptionService.getAccessControlState.mockResolvedValue({
            current_plan: 'trial',
            features_locked: false
        });
        const req = { method: 'GET', originalUrl: '/api/reports', companyId: 'c1', userRoles: ['b2b'] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'PLAN_RESTRICTED' }) })
        );
    });

    it('allows non-trial plans to access trial-restricted prefixes when not locked', async () => {
        subscriptionService.getAccessControlState.mockResolvedValue({
            current_plan: 'standard',
            features_locked: false
        });
        const req = { method: 'GET', originalUrl: '/api/reports', companyId: 'c1', userRoles: ['b2b'] };
        const res = createRes();
        const next = jest.fn();

        await enforceSubscriptionAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
