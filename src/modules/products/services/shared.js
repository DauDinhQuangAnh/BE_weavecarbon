const toNumber = (value, fallback = 0) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
};

const toPayloadObject = (payload) => {
    if (!payload) return {};
    if (typeof payload === 'object' && !Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            return {};
        }
    }
    return {};
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const safeArray = (value) => (Array.isArray(value) ? value : []);

const isDemoUser = async (client, userId) => {
    if (!userId) return false;

    const result = await client.query(
        'SELECT is_demo_user FROM users WHERE id = $1',
        [userId]
    );

    return result.rows[0]?.is_demo_user === true;
};

module.exports = {
    toNumber,
    toPositiveInt,
    toPayloadObject,
    isNonEmptyString,
    safeArray,
    isDemoUser
};
