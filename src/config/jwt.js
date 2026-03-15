require('dotenv').config();

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  jwtIssuer: 'weavecarbon',
  jwtAudience: 'weavecarbon-api'
};
