const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
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
    transport: isProduction
        ? undefined
        : {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
          }
});

module.exports = logger;
