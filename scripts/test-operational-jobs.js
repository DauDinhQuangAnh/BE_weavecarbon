#!/usr/bin/env node

require('dotenv').config();

const crypto = require('crypto');
const pool = require('../src/config/database');
const { createJobRepository } = require('../src/operations/jobRepository');

async function main() {
  const repository = createJobRepository({ database: pool });
  const suffix = crypto.randomUUID();
  const idempotencyKey = `ci:m4:${suffix}`;

  try {
    const accepted = await repository.enqueue({
      type: 'ci_probe',
      idempotencyKey,
      payload: { probe: suffix },
      maxAttempts: 2,
      correlationId: `ci-${suffix}`
    });
    const duplicate = await repository.enqueue({
      type: 'ci_probe',
      idempotencyKey,
      payload: { probe: suffix },
      maxAttempts: 2
    });
    if (!accepted.accepted || duplicate.accepted || accepted.id !== duplicate.id) {
      throw new Error('Idempotent enqueue contract failed.');
    }

    const firstClaim = await repository.claimNext('ci-worker-one');
    if (!firstClaim || firstClaim.idempotency_key !== idempotencyKey || firstClaim.attempts !== 1) {
      throw new Error('Initial SKIP LOCKED claim failed.');
    }

    await pool.query(
      `UPDATE operational_jobs SET locked_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [firstClaim.id]
    );
    const recovered = await repository.recoverStale(1000);
    if (recovered < 1) throw new Error('Interrupted job recovery failed.');

    const secondClaim = await repository.claimNext('ci-worker-two');
    if (!secondClaim || secondClaim.id !== firstClaim.id || secondClaim.attempts !== 2) {
      throw new Error('Recovered job was not reclaimed.');
    }
    const terminalStatus = await repository.fail(secondClaim, 'intentional CI failure', 1);
    if (terminalStatus !== 'dead') throw new Error('Max-attempt dead-job transition failed.');

    const { rows } = await pool.query(
      `SELECT status, last_error FROM operational_jobs WHERE id = $1`,
      [firstClaim.id]
    );
    if (rows[0]?.status !== 'dead' || rows[0]?.last_error !== 'intentional CI failure') {
      throw new Error('Dead-job evidence was not retained.');
    }
    console.log('M4 durable queue drill passed: idempotency, recovery, retry and dead-job retention.');
  } finally {
    await pool.query('DELETE FROM operational_jobs WHERE idempotency_key = $1', [idempotencyKey]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
