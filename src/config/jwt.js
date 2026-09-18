require('dotenv').config();

const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  ...(process.env.NODE_ENV === 'production' ? ['MFA_ENCRYPTION_KEY'] : [])
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `[config/jwt] Missing required environment variable(s): ${missingEnvVars.join(', ')}. Set them before starting the server.`
  );
}

if (process.env.MFA_ENCRYPTION_KEY) {
  const encodedKey = String(process.env.MFA_ENCRYPTION_KEY).trim();
  const key = /^[a-f0-9]{64}$/i.test(encodedKey)
    ? Buffer.from(encodedKey, 'hex')
    : Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('[config/jwt] MFA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
}

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  jwtIssuer: 'weavecarbon',
  jwtAudience: 'weavecarbon-api'
};
