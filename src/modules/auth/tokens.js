const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const jwtConfig = require('../shared/jwt');

const hashRefreshToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

const decodeJwtExpiry = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded.exp !== 'number') return null;
  return new Date(decoded.exp * 1000);
};

const hashPassword = async (password) => bcrypt.hash(password, 10);

const verifyPassword = async (password, hashedPassword) => bcrypt.compare(password, hashedPassword);

const generateSystemPassword = (length = 20) => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '!@#$%^&*';
  const all = `${upper}${lower}${numbers}${symbols}`;
  const pick = (source) => source.charAt(crypto.randomInt(0, source.length));
  const password = [pick(upper), pick(lower), pick(numbers), pick(symbols)];

  while (password.length < length) password.push(pick(all));

  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join('');
};

const generateAccessToken = (userId, email, roles, companyId = null, isDemo = false) => jwt.sign(
  {
    sub: userId,
    type: 'access',
    email,
    roles,
    is_demo: isDemo,
    company_id: companyId
  },
  jwtConfig.jwtSecret,
  {
    expiresIn: jwtConfig.jwtExpiresIn,
    issuer: jwtConfig.jwtIssuer,
    audience: jwtConfig.jwtAudience
  }
);

const generateRefreshToken = (userId, rememberMe = true) => jwt.sign(
  { sub: userId, type: 'refresh', jti: uuidv4(), remember_me: rememberMe !== false },
  jwtConfig.jwtRefreshSecret,
  {
    expiresIn: jwtConfig.jwtRefreshExpiresIn,
    issuer: jwtConfig.jwtIssuer,
    audience: jwtConfig.jwtAudience
  }
);

const generateCompanyInviteToken = ({ email, companyId }) => jwt.sign(
  {
    email: String(email || '').trim().toLowerCase(),
    company_id: companyId,
    type: 'company_invite'
  },
  jwtConfig.jwtSecret,
  {
    expiresIn: '7d',
    issuer: jwtConfig.jwtIssuer,
    audience: jwtConfig.jwtAudience
  }
);

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, jwtConfig.jwtSecret, {
      issuer: jwtConfig.jwtIssuer,
      audience: jwtConfig.jwtAudience
    });
  } catch {
    return null;
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, jwtConfig.jwtRefreshSecret, {
      issuer: jwtConfig.jwtIssuer,
      audience: jwtConfig.jwtAudience
    });
  } catch {
    return null;
  }
};

const verifyCompanyInviteToken = (token) => {
  try {
    return jwt.verify(token, jwtConfig.jwtSecret, {
      issuer: jwtConfig.jwtIssuer,
      audience: jwtConfig.jwtAudience
    });
  } catch {
    return null;
  }
};

const generateVerificationToken = (email) => jwt.sign(
  { email, type: 'email_verification' },
  jwtConfig.jwtSecret,
  { expiresIn: '24h' }
);

const verifyEmailToken = (token) => {
  try {
    return jwt.verify(token, jwtConfig.jwtSecret);
  } catch {
    return null;
  }
};

module.exports = {
  hashRefreshToken,
  decodeJwtExpiry,
  hashPassword,
  verifyPassword,
  generateSystemPassword,
  generateAccessToken,
  generateRefreshToken,
  generateCompanyInviteToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyCompanyInviteToken,
  generateVerificationToken,
  verifyEmailToken
};
