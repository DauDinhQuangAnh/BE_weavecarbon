const crypto = require('crypto');
const { buildError, normalizeMetadata } = require('./helpers');

const VNPAY_PAYMENT_URL_EXPIRY_MINUTES = 15;
const VNPAY_SUCCESS_CODE = '00';

const getBackendBaseUrl = () => {
    return (process.env.AUTH_PUBLIC_BASE_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');
};

const getVnpayMode = () => {
    return (process.env.VNPAY_MODE || 'sandbox').trim().toLowerCase();
};

const getVnpayConfig = () => {
    const mode = getVnpayMode();
    const backendBaseUrl = getBackendBaseUrl();
    const payUrl = (process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html').trim();
    const queryDrUrl = (process.env.VNPAY_QUERYDR_URL || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction').trim();
    const returnUrl = (process.env.VNPAY_RETURN_URL || `${backendBaseUrl}/api/subscription/vnpay/return`).trim();
    const ipnUrl = (process.env.VNPAY_IPN_URL || `${backendBaseUrl}/api/subscription/vnpay/ipn`).trim();
    const tmnCode = (process.env.VNPAY_TMN_CODE || '').trim();
    const hashSecret = (process.env.VNPAY_HASH_SECRET || '').trim();

    return { mode, backendBaseUrl, payUrl, queryDrUrl, returnUrl, ipnUrl, tmnCode, hashSecret };
};

const formatVnpayDate = (date = new Date()) => {
    const offsetMs = 7 * 60 * 60 * 1000;
    const local = new Date(date.getTime() + offsetMs);
    const yyyy = local.getUTCFullYear();
    const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    const HH = String(local.getUTCHours()).padStart(2, '0');
    const mm = String(local.getUTCMinutes()).padStart(2, '0');
    const ss = String(local.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
};

const buildVnpaySignedPayload = (params) => {
    const orderedKeys = Object.keys(params).sort();
    return orderedKeys
        .map((key) => {
            const value = params[key];
            const normalizedValue = value === null || typeof value === 'undefined' ? '' : String(value);
            return `${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue).replace(/%20/g, '+')}`;
        })
        .join('&');
};

const signVnpayParams = (params, hashSecret) => {
    const payload = buildVnpaySignedPayload(params);
    return crypto.createHmac('sha512', hashSecret).update(Buffer.from(payload, 'utf-8')).digest('hex');
};

const signVnpayPipePayload = (values, hashSecret) => {
    const payload = values
        .map((value) => (value === null || typeof value === 'undefined' ? '' : String(value)))
        .join('|');
    return crypto.createHmac('sha512', hashSecret).update(Buffer.from(payload, 'utf-8')).digest('hex');
};

const parseVnpayTimestamp = (value) => {
    const raw = String(value || '').trim();
    if (!/^\d{14}$/.test(raw)) return null;

    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6)) - 1;
    const day = Number(raw.slice(6, 8));
    const hour = Number(raw.slice(8, 10));
    const minute = Number(raw.slice(10, 12));
    const second = Number(raw.slice(12, 14));
    const parsed = new Date(Date.UTC(year, month, day, hour - 7, minute, second));

    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const createVnpayRequestId = (prefix = 'QDR') => {
    const random = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, '0');
    return `${prefix}${Date.now()}${random}`.slice(0, 32);
};

const isSuccessfulVnpayResult = (responseCode, transactionStatus = '') => {
    const normalizedResponseCode = String(responseCode || '').trim();
    const normalizedTransactionStatus = String(transactionStatus || '').trim();
    return (
        normalizedResponseCode === VNPAY_SUCCESS_CODE &&
        (!normalizedTransactionStatus || normalizedTransactionStatus === VNPAY_SUCCESS_CODE)
    );
};

const isFailedVnpayResult = (responseCode, transactionStatus = '') => {
    const normalizedResponseCode = String(responseCode || '').trim();
    const normalizedTransactionStatus = String(transactionStatus || '').trim();

    if (!normalizedResponseCode && !normalizedTransactionStatus) {
        return false;
    }

    return (
        (normalizedResponseCode && normalizedResponseCode !== VNPAY_SUCCESS_CODE) ||
        (normalizedTransactionStatus && normalizedTransactionStatus !== VNPAY_SUCCESS_CODE)
    );
};

const extractClientIp = (rawValue) => {
    if (!rawValue) return '127.0.0.1';
    if (Array.isArray(rawValue)) {
        return extractClientIp(rawValue[0]);
    }
    const normalized = String(rawValue).split(',')[0].trim();
    if (!normalized) return '127.0.0.1';
    if (normalized === '::1') return '127.0.0.1';
    return normalized.replace('::ffff:', '');
};

const buildVnpayPaymentUrl = (options) => {
    const config = getVnpayConfig();
    if (!config.tmnCode || !config.hashSecret) {
        throw buildError(
            'VNPay is not configured. Missing VNPAY_TMN_CODE or VNPAY_HASH_SECRET.',
            'PAYMENT_CONFIG_MISSING',
            500
        );
    }

    const createDate = formatVnpayDate(new Date());
    const expireDate = formatVnpayDate(
        new Date(Date.now() + VNPAY_PAYMENT_URL_EXPIRY_MINUTES * 60 * 1000)
    );

    const params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: config.tmnCode,
        vnp_Locale: 'vn',
        vnp_CurrCode: 'VND',
        vnp_TxnRef: options.transactionRef,
        vnp_OrderInfo: options.orderInfo,
        vnp_OrderType: 'other',
        vnp_Amount: Math.round(Number(options.amount) * 100),
        vnp_ReturnUrl: config.returnUrl,
        vnp_IpAddr: extractClientIp(options.ipAddr),
        vnp_CreateDate: createDate,
        vnp_ExpireDate: expireDate
    };
    if (options.bankCode) {
        params.vnp_BankCode = String(options.bankCode).trim();
    }

    const secureHash = signVnpayParams(params, config.hashSecret);
    const query = `${buildVnpaySignedPayload(params)}&vnp_SecureHash=${secureHash}`;
    return {
        paymentUrl: `${config.payUrl}?${query}`,
        createDate,
        expireDate,
        bankCode: options.bankCode ? String(options.bankCode).trim() : '',
        orderInfo: String(options.orderInfo || ''),
        amount: Math.round(Number(options.amount) || 0),
        transactionRef: String(options.transactionRef || '')
    };
};

const verifyVnpayReturnQuery = (query) => {
    const config = getVnpayConfig();
    const secureHash = String(query.vnp_SecureHash || '').trim();
    const secureHashType = String(query.vnp_SecureHashType || '').trim();

    if (!secureHash || !config.hashSecret) {
        return {
            isValidSignature: false,
            responseCode: String(query.vnp_ResponseCode || ''),
            transactionStatus: String(query.vnp_TransactionStatus || ''),
            transactionRef: String(query.vnp_TxnRef || ''),
            amount: Number(query.vnp_Amount || 0) || 0,
            transactionNo: String(query.vnp_TransactionNo || ''),
            bankCode: String(query.vnp_BankCode || ''),
            cardType: String(query.vnp_CardType || ''),
            payDate: String(query.vnp_PayDate || ''),
            orderInfo: String(query.vnp_OrderInfo || ''),
            rawPayload: {},
            secureHashType
        };
    }

    const payload = {};
    for (const [key, value] of Object.entries(query)) {
        if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
        payload[key] = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : String(value || '');
    }

    const calculatedHash = signVnpayParams(payload, config.hashSecret);
    return {
        isValidSignature: calculatedHash.toLowerCase() === secureHash.toLowerCase(),
        responseCode: String(payload.vnp_ResponseCode || ''),
        transactionStatus: String(payload.vnp_TransactionStatus || ''),
        transactionRef: String(payload.vnp_TxnRef || ''),
        amount: Number(payload.vnp_Amount || 0) || 0,
        transactionNo: String(payload.vnp_TransactionNo || ''),
        bankCode: String(payload.vnp_BankCode || ''),
        cardType: String(payload.vnp_CardType || ''),
        payDate: String(payload.vnp_PayDate || ''),
        orderInfo: String(payload.vnp_OrderInfo || ''),
        rawPayload: payload,
        secureHashType
    };
};

const buildVnpayQueryDrRequest = (session, options = {}) => {
    const config = getVnpayConfig();
    if (!config.tmnCode || !config.hashSecret) {
        throw buildError(
            'VNPay is not configured. Missing VNPAY_TMN_CODE or VNPAY_HASH_SECRET.',
            'PAYMENT_CONFIG_MISSING',
            500
        );
    }

    const metadata = normalizeMetadata(session?.metadata);
    const transactionDate = String(metadata.vnpay_payment_create_date || '').trim();
    if (!transactionDate) {
        throw buildError(
            'Payment session is missing VNPAY create date for QueryDR.',
            'VNPAY_QUERYDR_MISSING_CREATE_DATE',
            400
        );
    }

    const requestId = createVnpayRequestId();
    const createDate = formatVnpayDate(new Date());
    const ipAddr = extractClientIp(options.ipAddr);
    const orderInfo = String(
        metadata.vnpay_order_info ||
        metadata.order_info ||
        `Thanh toan goi ${session.target_plan}`
    );
    const requestPayload = {
        vnp_RequestId: requestId,
        vnp_Version: '2.1.0',
        vnp_Command: 'querydr',
        vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: String(session.gateway_transaction_ref || ''),
        vnp_OrderInfo: orderInfo,
        vnp_TransactionDate: transactionDate,
        vnp_CreateDate: createDate,
        vnp_IpAddr: ipAddr
    };

    requestPayload.vnp_SecureHash = signVnpayPipePayload(
        [
            requestPayload.vnp_RequestId,
            requestPayload.vnp_Version,
            requestPayload.vnp_Command,
            requestPayload.vnp_TmnCode,
            requestPayload.vnp_TxnRef,
            requestPayload.vnp_TransactionDate,
            requestPayload.vnp_CreateDate,
            requestPayload.vnp_IpAddr,
            requestPayload.vnp_OrderInfo
        ],
        config.hashSecret
    );

    return requestPayload;
};

const verifyVnpayQueryDrResponse = (payload) => {
    const config = getVnpayConfig();
    const secureHash = String(payload?.vnp_SecureHash || '').trim();
    if (!secureHash || !config.hashSecret) {
        return false;
    }

    const calculatedHash = signVnpayPipePayload(
        [
            payload.vnp_RequestId,
            payload.vnp_Version,
            payload.vnp_Command,
            payload.vnp_TmnCode,
            payload.vnp_ResponseCode,
            payload.vnp_Message,
            payload.vnp_TxnRef,
            payload.vnp_Amount,
            payload.vnp_BankCode,
            payload.vnp_PayDate,
            payload.vnp_TransactionNo,
            payload.vnp_TransactionStatus,
            payload.vnp_OrderInfo,
            payload.vnp_PromotionCode,
            payload.vnp_PromotionAmount
        ],
        config.hashSecret
    );

    return calculatedHash.toLowerCase() === secureHash.toLowerCase();
};

module.exports = {
    VNPAY_PAYMENT_URL_EXPIRY_MINUTES,
    VNPAY_SUCCESS_CODE,
    getBackendBaseUrl,
    getVnpayMode,
    getVnpayConfig,
    formatVnpayDate,
    buildVnpaySignedPayload,
    signVnpayParams,
    signVnpayPipePayload,
    parseVnpayTimestamp,
    createVnpayRequestId,
    isSuccessfulVnpayResult,
    isFailedVnpayResult,
    extractClientIp,
    buildVnpayPaymentUrl,
    verifyVnpayReturnQuery,
    buildVnpayQueryDrRequest,
    verifyVnpayQueryDrResponse
};
