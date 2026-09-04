const axios = require('axios');

jest.mock('axios', () => ({
  request: jest.fn(),
  isAxiosError: jest.fn(() => false)
}));

jest.mock('../../../src/services/analyticsService', () => ({
  enqueueEvent: jest.fn(),
  trackEvent: jest.fn(),
  queuePendingDispatch: jest.fn()
}));

const chatService = require('../../../src/services/chatService');
const { requestContext } = require('../../../src/middleware/requestContext');

const ENV_KEYS = [
  'RAG_INTERNAL_API_KEY',
  'RAG_REQUIRE_INTERNAL_API_KEY',
  'RAG_PROXY_ALLOWED_BASE_URLS',
  'RAG_PROXY_INTERNAL_BASE_URL'
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

test('adds the server-side internal key and overwrites caller-provided values', () => {
  process.env.RAG_INTERNAL_API_KEY = 'server-secret';
  process.env.RAG_REQUIRE_INTERNAL_API_KEY = 'true';

  expect(
    chatService.buildRagRequestHeaders({
      'Content-Type': 'application/json',
      'x-internal-api-key': 'caller-value'
    })
  ).toEqual({
    'Content-Type': 'application/json',
    'X-Internal-API-Key': 'server-secret'
  });
});

test('fails closed with a stable error when the required key is missing', () => {
  delete process.env.RAG_INTERNAL_API_KEY;
  process.env.RAG_REQUIRE_INTERNAL_API_KEY = 'true';

  expect(() => chatService.buildRagRequestHeaders()).toThrow(
    expect.objectContaining({
      code: 'RAG_INTERNAL_AUTH_NOT_CONFIGURED',
      statusCode: 503
    })
  );
});

test('allows an explicit local-only opt-out', () => {
  delete process.env.RAG_INTERNAL_API_KEY;
  process.env.RAG_REQUIRE_INTERNAL_API_KEY = 'false';

  expect(chatService.buildRagRequestHeaders({ Accept: 'application/json' })).toEqual({
    Accept: 'application/json'
  });
});

test('uses the private service URL, bounded timeout and internal header', async () => {
  process.env.RAG_INTERNAL_API_KEY = 'server-secret';
  process.env.RAG_REQUIRE_INTERNAL_API_KEY = 'true';
  process.env.RAG_PROXY_ALLOWED_BASE_URLS = 'https://weavecarbon.com/rag';
  process.env.RAG_PROXY_INTERNAL_BASE_URL = 'http://rag:8000';
  axios.request.mockResolvedValueOnce({ status: 200, data: { status: 'ok' } });

  await expect(
    chatService.callRagEndpoint(
      { rag_base_url: 'https://weavecarbon.com/rag', timeout_ms: 4321 },
      '/runtime-status'
    )
  ).resolves.toEqual({ status: 'ok' });

  expect(axios.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'http://rag:8000/runtime-status',
      timeout: 4321,
      headers: { 'X-Internal-API-Key': 'server-secret' }
    })
  );
});

test('propagates the inbound correlation ID to RAG', (done) => {
  process.env.RAG_INTERNAL_API_KEY = 'server-secret';
  process.env.RAG_REQUIRE_INTERNAL_API_KEY = 'true';
  const req = { get: () => 'trace-rag-123' };
  const res = { setHeader: jest.fn() };

  requestContext(req, res, () => {
    setImmediate(() => {
      expect(chatService.buildRagRequestHeaders()).toEqual({
        'X-Internal-API-Key': 'server-secret',
        'X-Correlation-ID': 'trace-rag-123'
      });
      done();
    });
  });
});
