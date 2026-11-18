#!/usr/bin/env node
/**
 * Manually purge expired demo users (see src/modules/auth/demoCleanupService.js).
 *   node scripts/purge-expired-demo-users.js --dry-run   # only count
 *   node scripts/purge-expired-demo-users.js             # delete one batch
 *   node scripts/purge-expired-demo-users.js --all       # repeat until none left
 */
require('dotenv').config();
const { demoCleanupService } = require('../src/modules/auth');
const pool = require('../src/config/database');

async function main() {
  const args = new Set(process.argv.slice(2));
  const expired = await demoCleanupService.countExpired();
  console.log(`[demo-cleanup] expired demo users: ${expired}`);
  if (args.has('--dry-run') || expired === 0) return;
  let total = { deleted: 0, skipped: 0 };
  let keepGoing = true;
  while (keepGoing) {
    const result = await demoCleanupService.purgeExpiredDemoUsers();
    total = { deleted: total.deleted + result.deleted, skipped: total.skipped + result.skipped };
    console.log(`[demo-cleanup] batch: scanned=${result.scanned} deleted=${result.deleted} skipped=${result.skipped}`);
    keepGoing = args.has('--all') && result.deleted > 0;
  }
  console.log(`[demo-cleanup] done: deleted=${total.deleted} skipped=${total.skipped}`);
}

main()
  .catch((error) => {
    console.error('[demo-cleanup] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
