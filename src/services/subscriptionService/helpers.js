const DAY_MS = 24 * 60 * 60 * 1000;

const buildError = (message, code, statusCode) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
};

const toIsoOrNull = (value) => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const calcDaysRemaining = (toDate) => {
    if (!toDate) return 0;
    const end = new Date(toDate).getTime();
    return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
};

const normalizeMetadata = (value) => {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

const mergeMetadata = (existingValue, patchValue) => {
    const existing = normalizeMetadata(existingValue);
    const patch = normalizeMetadata(patchValue);
    const next = { ...existing };

    for (const [key, value] of Object.entries(patch)) {
        if (typeof value !== 'undefined') {
            next[key] = value;
        }
    }

    return next;
};

const toPublicPaymentStatus = (status) => {
    if (status === 'success') return 'paid';
    if (status === 'expired') return 'expired';
    if (status === 'failed' || status === 'cancelled') return 'failed';
    return 'pending';
};

const isPaymentSessionExpired = (session) => {
    if (!session?.expires_at) return false;
    return new Date(session.expires_at).getTime() < Date.now();
};

module.exports = {
    buildError,
    toIsoOrNull,
    calcDaysRemaining,
    normalizeMetadata,
    mergeMetadata,
    toPublicPaymentStatus,
    isPaymentSessionExpired
};
