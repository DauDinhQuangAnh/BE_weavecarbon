const path = require('path');

const readPositiveInteger = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const READ_CACHE_TTL_MS = readPositiveInteger('READ_CACHE_TTL_MS', 30000);

module.exports = {
  EXPORT_JOB_CONCURRENCY: readPositiveInteger('EXPORT_JOB_CONCURRENCY', 1),
  READ_CACHE_TTL_MS,
  SLOW_REQUEST_MS: readPositiveInteger('SLOW_REQUEST_MS', 500),
  EMISSION_FACTORS_CACHE_TTL_MS: readPositiveInteger(
    'EMISSION_FACTORS_CACHE_TTL_MS',
    Math.max(READ_CACHE_TTL_MS, 5 * 60 * 1000)
  ),
  UPLOADS_ROOT: path.resolve(process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads'))
};
