const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};
const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn()
};

jest.mock('../../../src/config/database', () => mockPool);
jest.mock('../../../src/services/analyticsService', () => ({
  enqueueEvent: jest.fn(),
  queuePendingDispatch: jest.fn()
}));

const subscriptionService = require('../../../src/services/subscriptionService');

describe('payment callback idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionService.ensureSchema = jest.fn().mockResolvedValue();
  });

  test('a duplicate callback locks the session and performs no repeated upgrade writes', async () => {
    const completedSession = {
      id: 'session-1',
      company_id: 'company-1',
      user_id: 'user-1',
      target_plan: 'standard_20',
      amount: '299000',
      metadata: {},
      billing_cycle: 'monthly',
      payment_provider: 'vnpay',
      status: 'success',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      paid_at: new Date().toISOString()
    };
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [completedSession] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await subscriptionService.completeUpgrade('session-1', '00', {
      source: 'ipn',
      transactionStatus: '00'
    });

    expect(result).toEqual({
      updated: false,
      current_plan: 'standard',
      message: 'Session already completed'
    });
    expect(mockClient.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(mockClient.query.mock.calls.map(([sql]) => sql.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('SELECT'),
      'COMMIT'
    ]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
