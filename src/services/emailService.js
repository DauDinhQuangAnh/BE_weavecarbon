const nodemailer = require('nodemailer');
const emailConfig = require('../config/email');
const {
  resolveFrontendBaseUrl,
  resolveBackendBaseUrl
} = require('../config/urls');

const transporter = emailConfig.enabled
  ? nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth
  })
  : null;

function logSkippedEmail(logEntries) {
  for (const entry of logEntries) {
    console.log(...entry);
  }

  return true;
}

async function deliverEmail(mailOptions) {
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildVerificationUrl(token, email, preferredFrontendOrigin = null) {
  const apiBaseUrl = resolveBackendBaseUrl();
  const verificationUrl = new URL(`${apiBaseUrl}/api/auth/verify-email`);
  verificationUrl.searchParams.set('token', token);
  verificationUrl.searchParams.set('email', email);

  const frontendOrigin = resolveFrontendBaseUrl(preferredFrontendOrigin);
  if (frontendOrigin) {
    verificationUrl.searchParams.set('frontend_origin', frontendOrigin);
  }

  return verificationUrl.toString();
}

function buildVerificationEmailHtml({
  title,
  subtitle,
  fullName,
  verificationUrl,
  buttonLabel,
  includeCredentials = false,
  email = '',
  temporaryPassword = ''
}) {
  const safeName = escapeHtml(fullName || 'there');
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(temporaryPassword);
  const safeTitle = escapeHtml(title);
  const safeSubtitle = escapeHtml(subtitle);
  const safeButtonLabel = escapeHtml(buttonLabel);
  const safeVerificationUrl = escapeHtml(verificationUrl);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
                <tr>
                  <td style="padding:28px 28px 20px;background:linear-gradient(135deg,#0ea5e9,#16a34a);color:#ffffff;text-align:center;">
                    <p style="margin:0;font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:0.92;">WeaveCarbon</p>
                    <h1 style="margin:10px 0 0;font-size:24px;line-height:1.3;font-weight:700;">${safeTitle}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 28px 0;text-align:center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;width:220px;">
                      <tr>
                        <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 14px;text-align:center;">
                          <p style="margin:0;font-size:40px;line-height:1;color:#16a34a;">&#10003;</p>
                          <p style="margin:10px 0 0;font-size:14px;line-height:1.5;font-weight:600;color:#166534;">Email verification</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 28px 0;color:#0f172a;">
                    <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hi ${safeName},</p>
                    <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#334155;">${safeSubtitle}</p>
                    <p style="margin:0;font-size:15px;line-height:1.7;color:#334155;">Please confirm your email to activate your account.</p>
                  </td>
                </tr>
                ${includeCredentials ? `
                <tr>
                  <td style="padding:18px 28px 0;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbeafe;border-radius:12px;background:#f8fbff;">
                      <tr>
                        <td style="padding:14px 16px;font-size:14px;line-height:1.7;color:#0f172a;">
                          <p style="margin:0 0 8px;"><strong>Email:</strong> ${safeEmail}</p>
                          <p style="margin:0;"><strong>Temporary Password:</strong> ${safePassword}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ` : ''}
                <tr>
                  <td align="center" style="padding:24px 28px 0;">
                    <a
                      href="${safeVerificationUrl}"
                      style="display:inline-block;padding:14px 28px;background:#16a34a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;"
                    >${safeButtonLabel}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 28px 28px;color:#64748b;">
                    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;">This link expires in 24 hours.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildPasswordResetUrl(token, email) {
  const resetUrl = new URL('/reset-password', resolveFrontendBaseUrl());
  resetUrl.searchParams.set('token', token);
  resetUrl.searchParams.set('email', email);
  return resetUrl.toString();
}

class EmailService {
  async sendVerificationEmail(email, token, fullName, temporaryPassword = null, options = {}) {
    if (!emailConfig.enabled) {
      return logSkippedEmail([
        ['[Email] Email not configured - skipping verification email'],
        ['[Email] Development mode: email verification auto-approved for:', email],
        ...(temporaryPassword
          ? [['[Email] Temporary password for', email, ':', temporaryPassword]]
          : [])
      ]);
    }

    const verificationUrl = buildVerificationUrl(
      token,
      email,
      options.frontendOrigin || null
    );
    const isTemporaryAccount = Boolean(temporaryPassword);
    const safeFullName = fullName || 'there';
    const emailContent = buildVerificationEmailHtml({
      title: isTemporaryAccount ? 'Your WeaveCarbon account is ready' : 'Verify your email address',
      subtitle: isTemporaryAccount
        ? 'Your company administrator created this account for you. Confirm your email to sign in securely.'
        : 'Thanks for joining WeaveCarbon. Confirm your email with one click to finish setup.',
      fullName,
      verificationUrl,
      buttonLabel: isTemporaryAccount ? 'Verify Email and Sign In' : 'Verify Email',
      includeCredentials: isTemporaryAccount,
      email,
      temporaryPassword: temporaryPassword || ''
    });

    const mailOptions = {
      from: emailConfig.from,
      to: email,
      subject: isTemporaryAccount ? 'Your WeaveCarbon account is ready' : 'Verify your WeaveCarbon account',
      text: isTemporaryAccount
        ? `Hi ${safeFullName}, your company account is ready. Verify your email here: ${verificationUrl}`
        : `Hi ${safeFullName}, verify your WeaveCarbon account here: ${verificationUrl}`,
      html: emailContent
    };

    return deliverEmail(mailOptions);
  }

  async sendPasswordResetEmail(email, token, fullName) {
    if (!emailConfig.enabled) {
      return logSkippedEmail([
        ['[Email] Email not configured - skipping password reset email'],
        ['[Email] Reset token for', email, ':', token]
      ]);
    }

    const resetUrl = buildPasswordResetUrl(token, email);

    const mailOptions = {
      from: emailConfig.from,
      to: email,
      subject: 'Reset your WeaveCarbon password',
      html: `
        <h1>Password Reset Request</h1>
        <p>Hi ${fullName},</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    };

    return deliverEmail(mailOptions);
  }

  async sendWelcomeEmail(email, fullName, password) {
    if (!emailConfig.enabled) {
      return logSkippedEmail([
        ['[Email] Email not configured - skipping welcome email'],
        ['[Email] Sub-account created for:', email, '| Password:', password]
      ]);
    }

    const loginUrl = `${resolveFrontendBaseUrl()}/auth`;

    const mailOptions = {
      from: emailConfig.from,
      to: email,
      subject: 'Your WeaveCarbon account is ready',
      html: `
        <h1>Welcome to WeaveCarbon, ${fullName}!</h1>
        <p>Your company administrator has created an account for you. You can login immediately.</p>
        <p><strong>Your login credentials:</strong></p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <br/>
        <a href="${loginUrl}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Login Now</a>
        <br/><br/>
        <p><strong>Important:</strong> We recommend changing your password after your first login.</p>
      `
    };

    return deliverEmail(mailOptions);
  }
}

module.exports = new EmailService();
