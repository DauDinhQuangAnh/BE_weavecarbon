require('dotenv').config();

// Check if email is configured
const isEmailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

module.exports = {
  enabled: isEmailConfigured,
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 10000),
  greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 10000),
  socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 15000),
  auth: isEmailConfigured ? {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  } : undefined,
  from: process.env.EMAIL_FROM
};
