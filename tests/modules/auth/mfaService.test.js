const {
  createMfaService,
  resolveEncryptionKey,
  base32Encode,
  base32Decode,
  totp
} = require('../../../src/modules/auth/mfaService');

describe('MFA service cryptographic and state controls', () => {
  test('implements the RFC 6238 SHA-1 six-digit vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
    expect(totp(secret, 59000)).toBe('287082');
    expect(base32Decode(secret).toString('ascii')).toBe('12345678901234567890');
  });

  test('requires exactly 32 bytes of MFA encryption key material', () => {
    expect(resolveEncryptionKey('00'.repeat(32))).toHaveLength(32);
    expect(resolveEncryptionKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32);
    expect(() => resolveEncryptionKey('too-short')).toThrow(/32-byte/);
  });

  test('keeps the previous enabled factor active while a rotation is pending', async () => {
    const pending = { id: 'pending', revision: 3, status: 'pending' };
    const enabled = { id: 'enabled', revision: 2, status: 'enabled' };
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes("status='enabled'")) return { rows: [enabled] };
        return { rows: [pending] };
      })
    };
    const service = createMfaService({ pool, encryptionKey: Buffer.alloc(32, 1) });

    await expect(service.getChallengeState('user-1')).resolves.toEqual({
      enabled: true,
      status: 'pending',
      revision: 3,
      activeRevision: 2
    });
  });

  test('a disabled latest revision cannot resurrect an older enabled factor', async () => {
    const disabled = { id: 'disabled', revision: 4, status: 'disabled' };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [disabled] }) };
    const service = createMfaService({ pool, encryptionKey: Buffer.alloc(32, 1) });

    await expect(service.getChallengeState('user-1')).resolves.toEqual({
      enabled: false,
      status: 'disabled',
      revision: 4,
      activeRevision: null
    });
  });
});
