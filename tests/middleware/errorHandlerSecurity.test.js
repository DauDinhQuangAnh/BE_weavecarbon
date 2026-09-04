jest.mock('../../src/utils/logger', () => ({ error: jest.fn() }));

const logger = require('../../src/utils/logger');
const { errorHandler } = require('../../src/middleware/errorHandler');

describe('production error safety', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  test('does not expose internal details, stack or query-string secrets', () => {
    process.env = { ...originalEnv, NODE_ENV: 'production', LOG_ERROR_STACK: 'true' };
    const error = Object.assign(new Error('database password=secret'), {
      details: { stack: 'sensitive stack' }
    });
    const req = { method: 'GET', originalUrl: '/api/payment?vnp_SecureHash=secret' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    errorHandler(error, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'GET /api/payment' }),
      'Unhandled request error'
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
