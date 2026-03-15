require('dotenv').config();

// Check if email is configured
const isEmailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

module.exports = {
  enabled: isEmailConfigured,
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: isEmailConfigured ? {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  } : undefined,
  from: process.env.EMAIL_FROM
};
