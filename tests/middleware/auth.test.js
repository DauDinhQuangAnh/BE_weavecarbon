jest.mock('../../src/services/authService');
jest.mock('../../src/services/companyMembersService');
jest.mock('../../src/middleware/subscriptionAccess', () => ({
    enforceSubscriptionAccess: jest.fn((req, res, next) => next())
}));

const authService = require('../../src/services/authService');
const { enforceSubscriptionAccess } = require('../../src/middleware/subscriptionAccess');
const { authenticate } = require('../../src/middleware/auth');

function createRes() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
    };
}

function createReq(headers = {}) {
    return { headers, method: 'GET', originalUrl: '/api/products' };
}

describe('authenticate', () => {
    it('rejects requests without a bearer token', async () => {
        const req = createReq();
        const res = createRes();
        const next = jest.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) })
        );
        expect(next).not.toHaveBeenCalled();
        expect(enforceSubscriptionAccess).not.toHaveBeenCalled();
    });

    it('rejects an invalid or expired token', async () => {
        authService.verifyAccessToken.mockReturnValue(null);
        const req = createReq({ authorization: 'Bearer bad-token' });
        const res = createRes();
        const next = jest.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_TOKEN' }) })
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a valid token whose user no longer exists', async () => {
        authService.verifyAccessToken.mockReturnValue({ sub: 'user-1', company_id: null });
        authService.getUserById.mockResolvedValue(null);
        const req = createReq({ authorization: 'Bearer good-token' });
        const res = createRes();
        const next = jest.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'USER_NOT_FOUND' }) })
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('hydrates req.user/userRoles/companyId and delegates to enforceSubscriptionAccess on success', async () => {
        authService.verifyAccessToken.mockReturnValue({ sub: 'user-1', company_id: 'company-1' });
        authService.getUserById.mockResolvedValue({ id: 'user-1', roles: ['b2b'], company_id: 'company-1' });
        const req = createReq({ authorization: 'Bearer good-token' });
        const res = createRes();
        const next = jest.fn();

        await authenticate(req, res, next);

        expect(req.userId).toBe('user-1');
        expect(req.userRoles).toEqual(['b2b']);
        expect(req.companyId).toBe('company-1');
        expect(enforceSubscriptionAccess).toHaveBeenCalledWith(req, res, next);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns a 500 when an unexpected error is thrown', async () => {
        authService.verifyAccessToken.mockImplementation(() => {
            throw new Error('boom');
        });
        const req = createReq({ authorization: 'Bearer good-token' });
        const res = createRes();
        const next = jest.fn();

        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) })
        );
        expect(next).not.toHaveBeenCalled();
    });
});
