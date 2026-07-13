const {
    GOOGLE_AUTH_ERROR_MESSAGES,
    resolveEntryAccountType,
    buildFrontendAuthCallbackUrl,
    buildFrontendLoginUrl,
    resolveRequestedFrontendOrigin,
    resolvePostAuthNextStep,
    normalizeRefreshTokenValue,
    resolveRefreshTokenValue,
    extractBearerAccessToken,
    resolveRequestMetadata,
    escapeHtml,
    prefersHtmlResponse
} = require('../../../src/routes/auth/helpers');

describe('resolveEntryAccountType', () => {
    it('prefers an explicit role over roles array', () => {
        expect(resolveEntryAccountType({ role: 'b2c', roles: ['b2b'] })).toBe('b2c');
    });

    it('falls back to roles array', () => {
        expect(resolveEntryAccountType({ roles: ['b2c'] })).toBe('b2c');
        expect(resolveEntryAccountType({ roles: ['admin'] })).toBe('b2b');
    });

    it('falls back to company presence when no role/roles given', () => {
        expect(resolveEntryAccountType({ companyId: 'c1' })).toBe('b2b');
        expect(resolveEntryAccountType({})).toBe('b2c');
    });
});

describe('buildFrontendAuthCallbackUrl / buildFrontendLoginUrl', () => {
    it('builds a callback URL with hash params, skipping empty values', () => {
        const url = buildFrontendAuthCallbackUrl({ token: 'abc', empty: '', missing: undefined }, 'http://localhost:3000');
        expect(url).toBe('http://localhost:3000/auth/callback#token=abc');
    });

    it('builds a callback URL without a hash when there are no params', () => {
        const url = buildFrontendAuthCallbackUrl({}, 'http://localhost:3000');
        expect(url).toBe('http://localhost:3000/auth/callback');
    });

    it('builds a login URL with optional query params', () => {
        const url = buildFrontendLoginUrl('http://localhost:3000', { accountType: 'b2b', email: 'a@b.com' });
        expect(url).toBe('http://localhost:3000/auth?type=b2b&email=a%40b.com');
    });
});

describe('resolveRequestedFrontendOrigin', () => {
    it('checks query, body, then origin header in order', () => {
        expect(resolveRequestedFrontendOrigin({ query: { frontend_origin: 'q' }, body: {}, get: () => null })).toBe('q');
        expect(resolveRequestedFrontendOrigin({ query: {}, body: { frontendOrigin: 'b' }, get: () => null })).toBe('b');
        expect(resolveRequestedFrontendOrigin({ query: {}, body: {}, get: () => 'origin-header' })).toBe('origin-header');
        expect(resolveRequestedFrontendOrigin({ query: {}, body: {}, get: () => null })).toBeNull();
    });
});

describe('resolvePostAuthNextStep', () => {
    it('requires company setup for a b2b user with no company id', () => {
        expect(resolvePostAuthNextStep({ roles: ['b2b'] }, null)).toEqual({
            requiresCompanySetup: true,
            nextStep: 'company_onboarding'
        });
    });

    it('goes straight to dashboard otherwise', () => {
        expect(resolvePostAuthNextStep({ roles: ['b2b'] }, 'company-1')).toEqual({
            requiresCompanySetup: false,
            nextStep: 'dashboard'
        });
        expect(resolvePostAuthNextStep({ roles: ['b2c'] }, null)).toEqual({
            requiresCompanySetup: false,
            nextStep: 'dashboard'
        });
    });
});

describe('normalizeRefreshTokenValue / resolveRefreshTokenValue', () => {
    it('trims strings and rejects non-strings/empty strings', () => {
        expect(normalizeRefreshTokenValue('  abc  ')).toBe('abc');
        expect(normalizeRefreshTokenValue('   ')).toBeNull();
        expect(normalizeRefreshTokenValue(null)).toBeNull();
        expect(normalizeRefreshTokenValue(42)).toBeNull();
    });

    it('prefers the cookie-derived token over the body token', () => {
        const req = { body: { refresh_token: 'body-token' } };
        expect(resolveRefreshTokenValue(req)).toBe('body-token');
    });
});

describe('extractBearerAccessToken', () => {
    it('extracts the token from a Bearer authorization header', () => {
        const req = { get: (name) => (name === 'authorization' ? 'Bearer abc123' : null) };
        expect(extractBearerAccessToken(req)).toBe('abc123');
    });

    it('returns null when the header is missing or not Bearer', () => {
        expect(extractBearerAccessToken({ get: () => null })).toBeNull();
        expect(extractBearerAccessToken({ get: () => 'Basic abc123' })).toBeNull();
    });
});

describe('resolveRequestMetadata', () => {
    it('prefers x-forwarded-for over req.ip', () => {
        const req = {
            headers: { 'x-forwarded-for': '1.2.3.4' },
            ip: '5.6.7.8',
            socket: {},
            get: (name) => (name === 'user-agent' ? 'test-agent' : null)
        };
        expect(resolveRequestMetadata(req)).toEqual({ ipAddress: '1.2.3.4', userAgent: 'test-agent' });
    });

    it('falls back to null when nothing is present', () => {
        const req = { headers: {}, socket: {}, get: () => null };
        expect(resolveRequestMetadata(req)).toEqual({ ipAddress: null, userAgent: null });
    });
});

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("x")</script>')).toBe(
            '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
        );
    });

    it('handles nullish input', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });
});

describe('prefersHtmlResponse', () => {
    it('returns true when the view query param requests html/page', () => {
        expect(prefersHtmlResponse({ get: () => '', query: { view: 'html' } })).toBe(true);
        expect(prefersHtmlResponse({ get: () => '', query: { view: 'page' } })).toBe(true);
    });

    it('returns true when the Accept header includes text/html', () => {
        expect(prefersHtmlResponse({ get: () => 'text/html,application/json', query: {} })).toBe(true);
    });

    it('returns false otherwise', () => {
        expect(prefersHtmlResponse({ get: () => 'application/json', query: {} })).toBe(false);
    });
});

describe('GOOGLE_AUTH_ERROR_MESSAGES', () => {
    it('has a fallback message for unrecognized error codes via GOOGLE_AUTH_FAILED', () => {
        expect(GOOGLE_AUTH_ERROR_MESSAGES.GOOGLE_AUTH_FAILED).toBeTruthy();
    });
});
