const pino = require('pino');

function createLogger({
  destination,
  environment = process.env.NODE_ENV || 'development',
  production = environment === 'production'
} = {}) {
  // pino-pretty is intentionally a development-only dependency and is not
  // present in runtime images. Deployed environments keep structured JSON logs.
  const prettyPrint = environment === 'development' && !production && !destination;

  return pino({
    level: process.env.LOG_LEVEL || (production ? 'info' : 'debug'),
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'headers.authorization',
            'headers.cookie',
            '*.password',
            '*.password_hash',
            '*.access_token',
            '*.refresh_token',
            '*.token',
            '*.secret',
            '*.vnp_SecureHash',
            '*.rawPayload'
        ],
        censor: '[REDACTED]'
    },
    transport: prettyPrint
        ? {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
          }
        : undefined
  }, destination);
}

const logger = createLogger();

module.exports = logger;
module.exports.createLogger = createLogger;
