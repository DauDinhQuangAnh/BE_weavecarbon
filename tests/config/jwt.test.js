// Prevent dotenv from refilling deleted vars from the real .env file on disk
// during these require-time fail-fast assertions.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('config/jwt fail-fast validation', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it('throws when JWT_SECRET is missing', () => {
        delete process.env.JWT_SECRET;
        process.env.JWT_REFRESH_SECRET = 'refresh-secret';

        expect(() => require('../../src/config/jwt')).toThrow(/JWT_SECRET/);
    });

    it('throws when JWT_REFRESH_SECRET is missing', () => {
        process.env.JWT_SECRET = 'secret';
        delete process.env.JWT_REFRESH_SECRET;

        expect(() => require('../../src/config/jwt')).toThrow(/JWT_REFRESH_SECRET/);
    });

    it('throws listing both variables when neither is set', () => {
        delete process.env.JWT_SECRET;
        delete process.env.JWT_REFRESH_SECRET;

        expect(() => require('../../src/config/jwt')).toThrow(/JWT_SECRET, JWT_REFRESH_SECRET/);
    });

    it('loads successfully when both secrets are present', () => {
        process.env.JWT_SECRET = 'secret';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret';

        const jwtConfig = require('../../src/config/jwt');

        expect(jwtConfig.jwtSecret).toBe('secret');
        expect(jwtConfig.jwtRefreshSecret).toBe('refresh-secret');
        expect(jwtConfig.jwtExpiresIn).toBe('15m');
        expect(jwtConfig.jwtRefreshExpiresIn).toBe('30d');
    });
});
