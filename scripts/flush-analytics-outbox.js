#!/usr/bin/env node

require('dotenv').config();

const analyticsService = require('../src/services/analyticsService');
const pool = require('../src/config/database');

async function main() {
  const limit = Number(process.env.ANALYTICS_OUTBOX_FLUSH_LIMIT || 50);
  const results = await analyticsService.flushPendingEvents(limit);
  const sent = results.filter((item) => item.status === 'sent').length;
  const stored = results.filter((item) => item.status === 'stored').length;
  const failed = results.filter((item) => item.status === 'failed').length;

  console.log(
    `[analytics] Flush complete. processed=${results.length} sent=${sent} stored=${stored} failed=${failed}`
  );
}

main()
  .catch((error) => {
    console.error('[analytics] Flush failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
