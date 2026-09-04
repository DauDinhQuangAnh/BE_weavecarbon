const pino = require('pino');

function createLogger({ destination, production = process.env.NODE_ENV === 'production' } = {}) {
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
    transport: production || destination
        ? undefined
        : {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
          }
  }, destination);
}

const logger = createLogger();

module.exports = logger;
module.exports.createLogger = createLogger;
