const database = require('../shared/database');
const logger = require('../shared/logger');

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Removes demo users whose demo window (users.demo_expires_at) has passed.
 *
 * Every POST /api/auth/demo creates a real users row (is_demo_user = true,
 * demo_expires_at = now + 24h). Without this job those rows accumulate forever.
 *
 * Safety rules:
 * - only rows with is_demo_user = true AND an expired demo_expires_at are touched;
 * - a demo company is deleted only when no other user (demo or real) belongs to it;
 * - each user is removed in its own transaction, so one failure (for example an
 *   ON DELETE RESTRICT reference) skips that user instead of aborting the batch.
 */
function createDemoCleanupService({ pool = database, log = logger, now = () => new Date() } = {}) {
  const findExpired = async (client, batchSize) => {
    const result = await client.query(
      `SELECT u.id, p.company_id
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.is_demo_user = true
          AND u.demo_expires_at IS NOT NULL
          AND u.demo_expires_at < $1
        ORDER BY u.demo_expires_at ASC
        LIMIT $2`,
      [now(), batchSize]
    );
    return result.rows;
  };

  const countExpired = async () => {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM users
        WHERE is_demo_user = true
          AND demo_expires_at IS NOT NULL
          AND demo_expires_at < $1`,
      [now()]
    );
    return result.rows[0]?.count || 0;
  };

  const purgeExpiredDemoUsers = async ({ batchSize = DEFAULT_BATCH_SIZE } = {}) => {
    const client = await pool.connect();
    let deleted = 0;
    let skipped = 0;
    let scanned = 0;
    try {
      const rows = await findExpired(client, batchSize);
      scanned = rows.length;
      for (const row of rows) {
        try {
          await client.query('BEGIN');
          if (row.company_id) {
            await client.query(
              `DELETE FROM companies c
                WHERE c.id = $1
                  AND NOT EXISTS (
                    SELECT 1 FROM profiles p2
                     WHERE p2.company_id = c.id AND p2.user_id <> $2
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM company_members m
                     WHERE m.company_id = c.id AND m.user_id <> $2
                  )`,
              [row.company_id, row.id]
            );
          }
          await client.query(
            'DELETE FROM users WHERE id = $1 AND is_demo_user = true',
            [row.id]
          );
          await client.query('COMMIT');
          deleted += 1;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          skipped += 1;
          log.warn({ err: error, userId: row.id }, '[demoCleanup] Could not remove expired demo user');
        }
      }
    } finally {
      client.release();
    }
    if (scanned > 0) {
      log.info({ scanned, deleted, skipped }, '[demoCleanup] Expired demo users purged');
    }
    return { scanned, deleted, skipped };
  };

  const startScheduler = ({ intervalMs = DEFAULT_INTERVAL_MS } = {}) => {
    const run = () => {
      purgeExpiredDemoUsers().catch((error) => {
        log.warn({ err: error }, '[demoCleanup] Scheduled purge failed');
      });
    };
    const timer = setInterval(run, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return { stop: () => clearInterval(timer), runNow: run };
  };

  return { countExpired, purgeExpiredDemoUsers, startScheduler };
}

const demoCleanupService = createDemoCleanupService();

module.exports = {
  createDemoCleanupService,
  demoCleanupService,
  DEFAULT_DEMO_CLEANUP_INTERVAL_MS: DEFAULT_INTERVAL_MS
};
