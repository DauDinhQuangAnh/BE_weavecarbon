process.env.VNPAY_TMN_CODE = process.env.VNPAY_TMN_CODE || 'TESTTMN01';
process.env.VNPAY_HASH_SECRET = process.env.VNPAY_HASH_SECRET || 'testsecretHASH1234567890';

const vnpay = require('../../../src/services/subscriptionService/vnpay');

describe('formatVnpayDate', () => {
    it('formats a UTC date into VNPay yyyyMMddHHmmss (UTC+7)', () => {
        const date = new Date('2026-07-13T10:30:45.000Z');
        expect(vnpay.formatVnpayDate(date)).toBe('20260713173045');
    });
});

describe('buildVnpaySignedPayload', () => {
    it('sorts keys and URL-encodes with spaces as +', () => {
        const payload = vnpay.buildVnpaySignedPayload({ b: 'two words', a: 1 });
        expect(payload).toBe('a=1&b=two+words');
    });

    it('treats null/undefined values as empty strings', () => {
        expect(vnpay.buildVnpaySignedPayload({ a: null, b: undefined })).toBe('a=&b=');
    });
});

describe('signVnpayParams / signVnpayPipePayload', () => {
    it('produces a deterministic 128-char hex HMAC-SHA512 digest', () => {
        const sig1 = vnpay.signVnpayParams({ a: 1, b: 2 }, 'secret');
        const sig2 = vnpay.signVnpayParams({ b: 2, a: 1 }, 'secret');
        expect(sig1).toMatch(/^[0-9a-f]{128}$/);
        expect(sig1).toBe(sig2);
    });

    it('pipe-signing is sensitive to value order', () => {
        const sigA = vnpay.signVnpayPipePayload(['a', 'b'], 'secret');
        const sigB = vnpay.signVnpayPipePayload(['b', 'a'], 'secret');
        expect(sigA).not.toBe(sigB);
    });
});

describe('parseVnpayTimestamp', () => {
    it('parses a 14-digit VNPay timestamp back to a Date', () => {
        const date = vnpay.parseVnpayTimestamp('20260713173045');
        expect(date).toBeInstanceOf(Date);
        expect(date.toISOString()).toBe('2026-07-13T10:30:45.000Z');
    });

    it('returns null for malformed input', () => {
        expect(vnpay.parseVnpayTimestamp('not-a-timestamp')).toBeNull();
        expect(vnpay.parseVnpayTimestamp('')).toBeNull();
    });
});

describe('isSuccessfulVnpayResult / isFailedVnpayResult', () => {
    it('treats response code 00 (with matching/absent status) as success', () => {
        expect(vnpay.isSuccessfulVnpayResult('00', '00')).toBe(true);
        expect(vnpay.isSuccessfulVnpayResult('00', '')).toBe(true);
        expect(vnpay.isSuccessfulVnpayResult('24', '00')).toBe(false);
    });

    it('treats any non-00 code as failed, and blank/blank as not-failed', () => {
        expect(vnpay.isFailedVnpayResult('24', '')).toBe(true);
        expect(vnpay.isFailedVnpayResult('', '')).toBe(false);
        expect(vnpay.isFailedVnpayResult('00', '00')).toBe(false);
    });
});

describe('extractClientIp', () => {
    it('takes the first entry from a comma-separated or array value', () => {
        expect(vnpay.extractClientIp('203.0.113.5, 10.0.0.1')).toBe('203.0.113.5');
        expect(vnpay.extractClientIp(['203.0.113.5, 10.0.0.1'])).toBe('203.0.113.5');
    });

    it('normalizes loopback and IPv4-mapped IPv6', () => {
        expect(vnpay.extractClientIp('::1')).toBe('127.0.0.1');
        expect(vnpay.extractClientIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    });

    it('falls back to 127.0.0.1 for empty input', () => {
        expect(vnpay.extractClientIp('')).toBe('127.0.0.1');
        expect(vnpay.extractClientIp(null)).toBe('127.0.0.1');
    });
});

describe('buildVnpayPaymentUrl + verifyVnpayReturnQuery round-trip', () => {
    it('produces a URL whose query verifies successfully against the configured hash secret', () => {
        const built = vnpay.buildVnpayPaymentUrl({
            transactionRef: 'REF999',
            amount: 199000,
            ipAddr: '203.0.113.5',
            orderInfo: 'Test order',
            bankCode: 'VNPAYQR'
        });
        expect(built.paymentUrl).toContain('vnp_SecureHash=');

        const query = Object.fromEntries(new URLSearchParams(built.paymentUrl.split('?')[1]));
        const verification = vnpay.verifyVnpayReturnQuery(query);
        expect(verification.isValidSignature).toBe(true);
        expect(verification.transactionRef).toBe('REF999');
    });

    it('rejects a tampered signature', () => {
        const built = vnpay.buildVnpayPaymentUrl({
            transactionRef: 'REF1000',
            amount: 100000,
            ipAddr: '203.0.113.5',
            orderInfo: 'Test order'
        });
        const query = Object.fromEntries(new URLSearchParams(built.paymentUrl.split('?')[1]));
        query.vnp_Amount = String(Number(query.vnp_Amount) + 100);
        const verification = vnpay.verifyVnpayReturnQuery(query);
        expect(verification.isValidSignature).toBe(false);
    });

    it('throws PAYMENT_CONFIG_MISSING when tmnCode/hashSecret are absent', () => {
        const originalTmn = process.env.VNPAY_TMN_CODE;
        const originalSecret = process.env.VNPAY_HASH_SECRET;
        delete process.env.VNPAY_TMN_CODE;
        delete process.env.VNPAY_HASH_SECRET;
        try {
            expect(() => vnpay.buildVnpayPaymentUrl({ transactionRef: 'X', amount: 1, orderInfo: 'x' }))
                .toThrow('VNPay is not configured');
        } finally {
            process.env.VNPAY_TMN_CODE = originalTmn;
            process.env.VNPAY_HASH_SECRET = originalSecret;
        }
    });
});

describe('buildVnpayQueryDrRequest + verifyVnpayQueryDrResponse round-trip', () => {
    it('builds a signed QueryDR request', () => {
        const session = {
            gateway_transaction_ref: 'REF999',
            target_plan: 'standard',
            metadata: { vnpay_payment_create_date: '20260713100000' }
        };
        const request = vnpay.buildVnpayQueryDrRequest(session, { ipAddr: '203.0.113.5' });
        expect(request.vnp_Command).toBe('querydr');
        expect(request.vnp_TxnRef).toBe('REF999');
        expect(request.vnp_SecureHash).toMatch(/^[0-9a-f]{128}$/);
    });

    it('throws when the session is missing a create date', () => {
        const session = { gateway_transaction_ref: 'REF999', target_plan: 'standard', metadata: {} };
        expect(() => vnpay.buildVnpayQueryDrRequest(session)).toThrow('missing VNPAY create date');
    });

    it('verifies a correctly-signed QueryDR response payload', () => {
        const payload = {
            vnp_RequestId: 'QDR1', vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: 'TESTTMN01',
            vnp_ResponseCode: '00', vnp_Message: 'Success', vnp_TxnRef: 'REF999', vnp_Amount: '19900000',
            vnp_BankCode: 'NCB', vnp_PayDate: '20260713103045', vnp_TransactionNo: '1',
            vnp_TransactionStatus: '00', vnp_OrderInfo: 'x', vnp_PromotionCode: '', vnp_PromotionAmount: ''
        };
        payload.vnp_SecureHash = vnpay.signVnpayPipePayload([
            payload.vnp_RequestId, payload.vnp_Version, payload.vnp_Command, payload.vnp_TmnCode,
            payload.vnp_ResponseCode, payload.vnp_Message, payload.vnp_TxnRef, payload.vnp_Amount,
            payload.vnp_BankCode, payload.vnp_PayDate, payload.vnp_TransactionNo, payload.vnp_TransactionStatus,
            payload.vnp_OrderInfo, payload.vnp_PromotionCode, payload.vnp_PromotionAmount
        ], process.env.VNPAY_HASH_SECRET);

        expect(vnpay.verifyVnpayQueryDrResponse(payload)).toBe(true);
        payload.vnp_Amount = '99900000';
        expect(vnpay.verifyVnpayQueryDrResponse(payload)).toBe(false);
    });
});
