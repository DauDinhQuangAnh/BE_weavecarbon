require('dotenv').config();

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `[config/jwt] Missing required environment variable(s): ${missingEnvVars.join(', ')}. Set them before starting the server.`
  );
}

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  jwtIssuer: 'weavecarbon',
  jwtAudience: 'weavecarbon-api'
};
