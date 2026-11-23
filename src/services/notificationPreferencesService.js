const pool = require('../config/database');
const { createAppError } = require('../utils/appError');

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_KEYS = 50;

function invalid(message) {
  return createAppError(message, { statusCode: 400, code: 'INVALID_NOTIFICATION_PREFERENCES' });
}

function normalizePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('preferences must be an object of notification id → boolean.');
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_KEYS) throw invalid(`At most ${MAX_KEYS} notification preferences are allowed.`);
  const normalized = {};
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) throw invalid(`Invalid notification id: ${String(key).slice(0, 80)}`);
    if (typeof value !== 'boolean') throw invalid(`Preference ${key} must be true or false.`);
    normalized[key] = value;
  }
  return normalized;
}

function createNotificationPreferencesService({ database = pool } = {}) {
  return {
    async getPreferences(userId) {
      const { rows } = await database.query(
        'SELECT preferences, updated_at FROM public.user_notification_preferences WHERE user_id = $1',
        [userId]
      );
      return { preferences: rows[0]?.preferences || {}, updatedAt: rows[0]?.updated_at || null };
    },

    async updatePreferences(userId, input) {
      const preferences = normalizePreferences(input);
      const { rows } = await database.query(
        `INSERT INTO public.user_notification_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()
         RETURNING preferences, updated_at`,
        [userId, JSON.stringify(preferences)]
      );
      return { preferences: rows[0].preferences, updatedAt: rows[0].updated_at };
    }
  };
}

module.exports = createNotificationPreferencesService();
module.exports.createNotificationPreferencesService = createNotificationPreferencesService;
module.exports.normalizePreferences = normalizePreferences;
