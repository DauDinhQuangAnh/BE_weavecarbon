const path = require('path');

const readPositiveInteger = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const READ_CACHE_TTL_MS = readPositiveInteger('READ_CACHE_TTL_MS', 30000);

module.exports = {
  EXPORT_JOB_CONCURRENCY: readPositiveInteger('EXPORT_JOB_CONCURRENCY', 1),
  JOB_MAX_ATTEMPTS: readPositiveInteger('JOB_MAX_ATTEMPTS', 3),
  JOB_POLL_INTERVAL_MS: readPositiveInteger('JOB_POLL_INTERVAL_MS', 1000),
  JOB_RETRY_BASE_MS: readPositiveInteger('JOB_RETRY_BASE_MS', 5000),
  JOB_STALE_AFTER_MS: readPositiveInteger('JOB_STALE_AFTER_MS', 15 * 60 * 1000),
  ASYNC_IMPORT_THRESHOLD: readPositiveInteger('ASYNC_IMPORT_THRESHOLD', 25),
  READ_CACHE_TTL_MS,
  SHUTDOWN_GRACE_MS: readPositiveInteger('SHUTDOWN_GRACE_MS', 30000),
  SLOW_REQUEST_MS: readPositiveInteger('SLOW_REQUEST_MS', 500),
  EMISSION_FACTORS_CACHE_TTL_MS: readPositiveInteger(
    'EMISSION_FACTORS_CACHE_TTL_MS',
    Math.max(READ_CACHE_TTL_MS, 5 * 60 * 1000)
  ),
  UPLOADS_ROOT: path.resolve(process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads'))
};
