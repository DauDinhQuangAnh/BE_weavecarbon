process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-bbbbbbbbbbbbbbbbbbbbbbbb';

const tokens = require('../../../src/services/authService/tokens');

describe('hashRefreshToken', () => {
    it('returns a stable sha256 hex digest', () => {
        const hash = tokens.hashRefreshToken('some-refresh-token');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(tokens.hashRefreshToken('some-refresh-token')).toBe(hash);
    });

    it('handles empty/undefined input without throwing', () => {
        expect(tokens.hashRefreshToken(undefined)).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('decodeJwtExpiry', () => {
    it('returns a Date for a valid token', () => {
        const token = tokens.generateAccessToken('u1', 'a@b.com', ['owner']);
        const expiry = tokens.decodeJwtExpiry(token);
        expect(expiry).toBeInstanceOf(Date);
        expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null for garbage input', () => {
        expect(tokens.decodeJwtExpiry('not-a-jwt')).toBeNull();
    });
});

describe('hashPassword / verifyPassword', () => {
    it('round-trips a password through bcrypt', async () => {
        const hash = await tokens.hashPassword('correct horse battery staple');
        expect(await tokens.verifyPassword('correct horse battery staple', hash)).toBe(true);
        expect(await tokens.verifyPassword('wrong password', hash)).toBe(false);
    });
});

describe('generateSystemPassword', () => {
    it('generates a password of the requested length containing all character classes', () => {
        const password = tokens.generateSystemPassword(20);
        expect(password).toHaveLength(20);
        expect(password).toMatch(/[A-Z]/);
        expect(password).toMatch(/[a-z]/);
        expect(password).toMatch(/[0-9]/);
        expect(password).toMatch(/[!@#$%^&*]/);
    });
});

describe('generateAccessToken / verifyAccessToken', () => {
    it('round-trips claims through sign+verify', () => {
        const token = tokens.generateAccessToken('user-1', 'a@b.com', ['owner'], 'company-1', true);
        const decoded = tokens.verifyAccessToken(token);
        expect(decoded).toMatchObject({
            sub: 'user-1',
            type: 'access',
            email: 'a@b.com',
            roles: ['owner'],
            is_demo: true,
            company_id: 'company-1'
        });
    });

    it('returns null for an invalid token', () => {
        expect(tokens.verifyAccessToken('garbage')).toBeNull();
    });
});

describe('generateRefreshToken / verifyRefreshToken', () => {
    it('round-trips and includes a jti', () => {
        const token = tokens.generateRefreshToken('user-1', false);
        const decoded = tokens.verifyRefreshToken(token);
        expect(decoded).toMatchObject({ sub: 'user-1', type: 'refresh', remember_me: false });
        expect(typeof decoded.jti).toBe('string');
    });

    it('returns null for an invalid token', () => {
        expect(tokens.verifyRefreshToken('garbage')).toBeNull();
    });

    it('rejects an access token verified as a refresh token (wrong secret)', () => {
        const accessToken = tokens.generateAccessToken('user-1', 'a@b.com', ['owner']);
        expect(tokens.verifyRefreshToken(accessToken)).toBeNull();
    });
});

describe('generateCompanyInviteToken / verifyCompanyInviteToken', () => {
    it('round-trips and lowercases/trims the email', () => {
        const token = tokens.generateCompanyInviteToken({ email: '  User@Example.com  ', companyId: 'c1' });
        const decoded = tokens.verifyCompanyInviteToken(token);
        expect(decoded).toMatchObject({
            email: 'user@example.com',
            company_id: 'c1',
            type: 'company_invite'
        });
    });

    it('returns null for an invalid token', () => {
        expect(tokens.verifyCompanyInviteToken('garbage')).toBeNull();
    });
});

describe('generateVerificationToken / verifyEmailToken', () => {
    it('round-trips an email verification token', () => {
        const token = tokens.generateVerificationToken('a@b.com');
        const decoded = tokens.verifyEmailToken(token);
        expect(decoded).toMatchObject({ email: 'a@b.com', type: 'email_verification' });
    });

    it('returns null for an invalid token', () => {
        expect(tokens.verifyEmailToken('garbage')).toBeNull();
    });
});
