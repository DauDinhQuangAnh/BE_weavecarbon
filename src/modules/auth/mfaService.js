const crypto = require('crypto');
const database = require('../shared/database');
const tokenService = require('./tokens');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const blocked = (code, message, statusCode = 422) => ({ blocked: true, code, message, statusCode });

function resolveEncryptionKey(value = process.env.MFA_ENCRYPTION_KEY) {
  const raw = String(value || '').trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw Object.assign(new Error('MFA_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.'), { code: 'MFA_ENCRYPTION_KEY_INVALID' });
  return key;
}

function base32Encode(bytes) {
  let bits = ''; let output = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  for (let index = 0; index < bits.length; index += 5) output += BASE32[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

function base32Decode(value) {
  let bits = '';
  for (const character of String(value || '').replace(/=+$/g, '').toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, timeMs = Date.now(), offset = 0) {
  const counter = BigInt(Math.floor(timeMs / 30000) + offset);
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(counter);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const position = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(position) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, '0');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptSecret(secret, userId, key) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function decryptSecret(row, userId, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.secret_iv, 'base64'));
  decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(row.secret_auth_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.secret_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function recoveryCode() {
  let value = '';
  for (let index = 0; index < 16; index += 1) value += RECOVERY_ALPHABET[crypto.randomInt(0, RECOVERY_ALPHABET.length)];
  return value.match(/.{1,4}/g).join('-');
}

function recoveryHash(code, salt = crypto.randomBytes(16).toString('hex')) {
  const normalized = String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return { salt, hash: crypto.scryptSync(normalized, salt, 64).toString('hex') };
}

function createMfaService({ pool = database, encryptionKey = null, clock = () => Date.now() } = {}) {
  const key = () => encryptionKey || resolveEncryptionKey();
  const latest = async (userId, client = pool) => {
    const result = await client.query('SELECT * FROM user_mfa_factor_revisions WHERE user_id=$1 ORDER BY revision DESC LIMIT 1', [userId]);
    return result.rows[0] || null;
  };
  const active = async (userId, client = pool) => {
    const current = await latest(userId, client);
    if (!current || current.status === 'disabled') return null;
    if (current.status === 'enabled') return current;
    const result = await client.query(
      `SELECT * FROM user_mfa_factor_revisions
       WHERE user_id=$1 AND status='enabled' AND revision < $2
       ORDER BY revision DESC LIMIT 1`,
      [userId, current.revision]
    );
    return result.rows[0] || null;
  };
  const nextRevision = async (userId, client) => {
    const result = await client.query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM user_mfa_factor_revisions WHERE user_id=$1', [userId]);
    return Number(result.rows[0].revision);
  };
  const verifyTotp = (secret, code) => /^\d{6}$/.test(String(code || '')) && [-1, 0, 1].some((offset) => safeEqual(totp(secret, clock(), offset), code));

  return {
    async getChallengeState(userId) {
      const current = await latest(userId);
      const activeFactor = await active(userId);
      return {
        enabled: Boolean(activeFactor),
        status: current?.status || 'not_enrolled',
        revision: current ? Number(current.revision) : 0,
        activeRevision: activeFactor ? Number(activeFactor.revision) : null
      };
    },

    async getStatus(userId) {
      const current = await latest(userId);
      if (!current) return { status: 'not_enrolled', enabled: false, revision: 0 };
      const activeFactor = await active(userId);
      const consumed = activeFactor
        ? await pool.query('SELECT COUNT(*)::integer AS count FROM user_mfa_recovery_code_consumptions WHERE factor_revision_id=$1 AND user_id=$2', [activeFactor.id, userId])
        : { rows: [{ count: 0 }] };
      return {
        status: current.status,
        enabled: Boolean(activeFactor),
        revision: Number(current.revision),
        activeRevision: activeFactor ? Number(activeFactor.revision) : null,
        recoveryCodesRemaining: activeFactor
          ? activeFactor.recovery_code_hashes.length - Number(consumed.rows[0].count)
          : 0,
        createdAt: current.created_at
      };
    },

    async verifyChallenge(userId, code, client = pool) {
      const factor = await active(userId, client);
      if (!factor) return false;
      const normalized = String(code || '').trim();
      const secret = decryptSecret(factor, userId, key());
      if (verifyTotp(secret, normalized)) return true;
      for (const item of factor.recovery_code_hashes) {
        const candidate = recoveryHash(normalized, item.salt).hash;
        if (!safeEqual(candidate, item.hash)) continue;
        const consumed = await client.query(
          `INSERT INTO user_mfa_recovery_code_consumptions(user_id,factor_revision_id,recovery_hash)
           VALUES($1,$2,$3) ON CONFLICT (factor_revision_id,recovery_hash) DO NOTHING RETURNING id`,
          [userId, factor.id, item.hash]
        );
        return Boolean(consumed.rows[0]);
      }
      return false;
    },

    async beginEnrollment(userId, password, currentCode = null) {
      const user = await pool.query('SELECT id,email,password_hash FROM users WHERE id=$1', [userId]);
      if (!user.rows[0]?.password_hash || !await tokenService.verifyPassword(password, user.rows[0].password_hash)) return blocked('MFA_PASSWORD_INVALID', 'Current password is required.', 401);
      const secret = base32Encode(crypto.randomBytes(20)); const encrypted = encryptSecret(secret, userId, key());
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mfa:${userId}`]);
        const current = await latest(userId, client);
        const activeFactor = await active(userId, client);
        if (activeFactor && !await this.verifyChallenge(userId, currentCode, client)) {
          await client.query('ROLLBACK');
          return blocked('MFA_CURRENT_CODE_INVALID', 'Current MFA code is required to rotate the factor.', 401);
        }
        const revision = await nextRevision(userId, client);
        const inserted = await client.query(`INSERT INTO user_mfa_factor_revisions(user_id,revision,status,secret_ciphertext,secret_iv,secret_auth_tag,recovery_code_hashes,reason,created_by)
          VALUES($1,$2,'pending',$3,$4,$5,'[]'::jsonb,$6,$1) RETURNING id,revision,status,created_at`, [userId, revision, encrypted.ciphertext, encrypted.iv, encrypted.authTag, current?.status === 'enabled' ? 'MFA factor rotation initiated.' : 'MFA enrollment initiated.']);
        await client.query('COMMIT');
        const issuer = 'WeaveCarbon'; const label = `${issuer}:${user.rows[0].email}`;
        return { ...inserted.rows[0], revision: Number(inserted.rows[0].revision), secret,
          otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    },

    async confirmEnrollment(userId, code) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mfa:${userId}`]);
        const pending = await latest(userId, client);
        if (!pending || pending.status !== 'pending') { await client.query('ROLLBACK'); return blocked('MFA_ENROLLMENT_NOT_PENDING', 'No pending MFA enrollment exists.', 409); }
        const secret = decryptSecret(pending, userId, key());
        if (!verifyTotp(secret, code)) { await client.query('ROLLBACK'); return blocked('MFA_CODE_INVALID', 'The authenticator code is invalid.', 401); }
        const codes = Array.from({ length: 10 }, recoveryCode); const hashes = codes.map((value) => recoveryHash(value));
        const revision = await nextRevision(userId, client);
        const inserted = await client.query(`INSERT INTO user_mfa_factor_revisions(user_id,revision,status,secret_ciphertext,secret_iv,secret_auth_tag,recovery_code_hashes,reason,created_by)
          VALUES($1,$2,'enabled',$3,$4,$5,$6::jsonb,'MFA enrollment confirmed.',$1) RETURNING id,revision,status,created_at`,
        [userId, revision, pending.secret_ciphertext, pending.secret_iv, pending.secret_auth_tag, JSON.stringify(hashes)]);
        await client.query('COMMIT'); return { ...inserted.rows[0], revision: Number(inserted.rows[0].revision), recoveryCodes: codes };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    },

    async disable(userId, password, code, reason) {
      const normalizedReason = String(reason || '').trim();
      if (!normalizedReason) return blocked('MFA_DISABLE_REASON_REQUIRED', 'A reason is required to disable MFA.');
      const user = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
      if (!user.rows[0]?.password_hash || !await tokenService.verifyPassword(password, user.rows[0].password_hash)) return blocked('MFA_PASSWORD_INVALID', 'Current password is required.', 401);
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mfa:${userId}`]);
        if (!await this.verifyChallenge(userId, code, client)) {
          await client.query('ROLLBACK');
          return blocked('MFA_CODE_INVALID', 'A current authenticator or unused recovery code is required.', 401);
        }
        const revision = await nextRevision(userId, client);
        const inserted = await client.query(`INSERT INTO user_mfa_factor_revisions(user_id,revision,status,recovery_code_hashes,reason,created_by)
          VALUES($1,$2,'disabled','[]'::jsonb,$3,$1) RETURNING id,revision,status,created_at`, [userId, revision, normalizedReason]);
        await client.query('COMMIT'); return { ...inserted.rows[0], revision: Number(inserted.rows[0].revision) };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    }
  };
}

module.exports = { createMfaService, mfaService: createMfaService(), resolveEncryptionKey, base32Encode, base32Decode, totp };
