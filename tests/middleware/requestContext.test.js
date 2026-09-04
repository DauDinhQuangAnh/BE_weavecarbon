const { getCorrelationId, normalizeCorrelationId, requestContext } =
  require('../../src/middleware/requestContext');

describe('request correlation context', () => {
  test('preserves safe caller IDs and rejects unsafe values', () => {
    expect(normalizeCorrelationId('deploy-abc_123')).toBe('deploy-abc_123');
    expect(normalizeCorrelationId('secret\nheader')).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('propagates the ID through async work and the response header', (done) => {
    const req = { get: () => 'trace-123' };
    const res = { setHeader: jest.fn() };
    requestContext(req, res, () => {
      setImmediate(() => {
        expect(getCorrelationId()).toBe('trace-123');
        expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'trace-123');
        done();
      });
    });
  });
});
