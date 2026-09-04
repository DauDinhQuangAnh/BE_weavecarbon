const { Writable } = require('stream');
const { createLogger } = require('../../src/utils/logger');

describe('structured logger redaction', () => {
  test('redacts credentials while retaining operational context', (done) => {
    let output = '';
    const destination = new Writable({
      write(chunk, encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const logger = createLogger({ destination, production: true });
    logger.info({
      correlationId: 'trace-123',
      req: { headers: { authorization: 'Bearer secret', cookie: 'session=secret' } },
      user: { password: 'secret-password' }
    }, 'redaction probe');

    destination.end(() => {
      expect(output).toContain('trace-123');
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('Bearer secret');
      expect(output).not.toContain('secret-password');
      done();
    });
  });
});
