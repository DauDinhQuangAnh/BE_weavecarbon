const crypto = require('crypto');
const pool = require('../config/database');

function createJobRepository({ database = pool } = {}) {
  return {
    async enqueue(task) {
      const result = await database.query(
        `INSERT INTO operational_jobs (
           id, company_id, kind, idempotency_key, payload, max_attempts, correlation_id
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id, status, (xmax = 0) AS accepted`,
        [
          crypto.randomUUID(),
          task.companyId || null,
          task.type,
          task.idempotencyKey,
          JSON.stringify(task.payload || {}),
          task.maxAttempts,
          task.correlationId || null
        ]
      );
      return {
        accepted: Boolean(result.rows[0]?.accepted),
        id: result.rows[0]?.id || null,
        status: result.rows[0]?.status || 'pending'
      };
    },

    async recoverStale(staleAfterMs) {
      const result = await database.query(
        `UPDATE operational_jobs
         SET status = 'retry', locked_at = NULL, locked_by = NULL,
             available_at = NOW(), updated_at = NOW(),
             last_error = COALESCE(last_error, 'worker interrupted before completion')
         WHERE status = 'running'
           AND locked_at < NOW() - ($1::text || ' milliseconds')::interval`,
        [staleAfterMs]
      );
      return result.rowCount;
    },

    async backfillReports(defaultMaxAttempts) {
      const result = await database.query(
        `INSERT INTO operational_jobs (
           id, company_id, kind, idempotency_key, payload, max_attempts
         )
         SELECT gen_random_uuid(), r.company_id,
                CASE
                  WHEN r.report_type = 'dataset_export' THEN 'dataset_export'
                  WHEN r.report_type = 'compliance' AND r.file_format <> 'pdf' THEN 'market_compliance_report'
                  ELSE 'manual_report'
                END,
                'report:' || r.id::text,
                jsonb_strip_nulls(jsonb_build_object(
                  'reportId', r.id,
                  'companyId', r.company_id,
                  'datasetType', r.dataset_type,
                  'fileFormat', r.file_format
                )),
                $1
         FROM reports r
         WHERE r.status = 'processing' AND COALESCE(r.storage_key, '') = ''
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [defaultMaxAttempts]
      );
      return result.rowCount;
    },

    async backfillEvidence(defaultMaxAttempts) {
      const result = await database.query(
        `INSERT INTO operational_jobs (
           id, company_id, kind, idempotency_key, payload, max_attempts
         )
         SELECT gen_random_uuid(), e.company_id, 'evidence_process',
                'evidence:' || e.id::text,
                jsonb_build_object('evidenceId', e.id, 'companyId', e.company_id),
                $1
         FROM evidence_documents e
         WHERE e.status = 'uploaded'
           AND e.storage_provider = 'local'
           AND COALESCE(e.storage_key, '') <> ''
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [defaultMaxAttempts]
      );
      return result.rowCount;
    },

    async claimNext(workerId) {
      const result = await database.query(
        `WITH next_job AS (
           SELECT id
           FROM operational_jobs
           WHERE status IN ('pending', 'retry') AND available_at <= NOW()
           ORDER BY available_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE operational_jobs job
         SET status = 'running', attempts = attempts + 1,
             locked_at = NOW(), locked_by = $1, updated_at = NOW()
         FROM next_job
         WHERE job.id = next_job.id
         RETURNING job.*`,
        [workerId]
      );
      return result.rows[0] || null;
    },

    async complete(jobId, jobResult) {
      await database.query(
        `UPDATE operational_jobs
         SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
             locked_at = NULL, locked_by = NULL, last_error = NULL, result = $2::jsonb
         WHERE id = $1 AND status = 'running'`,
        [jobId, JSON.stringify(jobResult ?? null)]
      );
    },

    async fail(job, errorMessage, retryDelayMs) {
      const isDead = Number(job.attempts) >= Number(job.max_attempts);
      await database.query(
        `UPDATE operational_jobs
         SET status = $2, last_error = $3, updated_at = NOW(),
             available_at = CASE WHEN $2 = 'retry'
               THEN NOW() + ($4::text || ' milliseconds')::interval
               ELSE available_at END,
             locked_at = NULL, locked_by = NULL
         WHERE id = $1 AND status = 'running'`,
        [job.id, isDead ? 'dead' : 'retry', errorMessage.slice(0, 2000), retryDelayMs]
      );
      return isDead ? 'dead' : 'retry';
    },

    async counts() {
      const result = await database.query(
        `SELECT status, COUNT(*)::integer AS count
         FROM operational_jobs
         GROUP BY status`
      );
      return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
    },

    async findForCompany(jobId, companyId) {
      const result = await database.query(
        `SELECT id, kind, status, attempts, max_attempts, result, last_error,
                created_at, updated_at, completed_at
         FROM operational_jobs
         WHERE id = $1 AND company_id = $2`,
        [jobId, companyId]
      );
      return result.rows[0] || null;
    }
  };
}

module.exports = { createJobRepository, jobRepository: createJobRepository() };
