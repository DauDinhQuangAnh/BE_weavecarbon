#!/usr/bin/env node

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/database');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

function isNoTransactionMigration(sql) {
  return /^\s*--\s*no-transaction/im.test(sql) || /CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql);
}

function splitSqlStatements(sql) {
  const normalizedSql = sql.replace(/^\s*--.*$/gm, '');

  return normalizedSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function computeChecksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query(`
    SELECT name, checksum
    FROM public.schema_migrations
    ORDER BY name ASC
  `);

  return new Map(result.rows.map((row) => [row.name, row.checksum]));
}

async function recordMigration(name, checksum) {
  await pool.query(
    `
      INSERT INTO public.schema_migrations (name, checksum)
      VALUES ($1, $2)
    `,
    [name, checksum]
  );
}

async function applyTransactionalMigration(name, sql, checksum) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `
        INSERT INTO public.schema_migrations (name, checksum)
        VALUES ($1, $2)
      `,
      [name, checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function applyMigration(name, sql, checksum) {
  if (isNoTransactionMigration(sql)) {
    for (const statement of splitSqlStatements(sql)) {
      await pool.query(statement);
    }
    await recordMigration(name, checksum);
    return;
  }

  await applyTransactionalMigration(name, sql, checksum);
}

async function main() {
  await ensureMigrationsTable();

  const migrationFiles = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((fileName) => fileName.endsWith('.sql')).sort()
    : [];

  const appliedMigrations = await getAppliedMigrations();

  for (const fileName of migrationFiles) {
    const filePath = path.join(MIGRATIONS_DIR, fileName);
    const sql = fs.readFileSync(filePath, 'utf8').trim();

    if (!sql) {
      continue;
    }

    const checksum = computeChecksum(sql);
    const existingChecksum = appliedMigrations.get(fileName);

    if (existingChecksum) {
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${fileName}.`);
      }
      continue;
    }

    console.log(`[migrate] Applying ${fileName}`);
    await applyMigration(fileName, sql, checksum);
  }

  console.log('[migrate] Database migrations are up to date');
}

main()
  .catch((error) => {
    console.error('[migrate] Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
