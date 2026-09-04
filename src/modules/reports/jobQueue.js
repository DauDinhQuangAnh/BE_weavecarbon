const os = require('os');
const {
  EXPORT_JOB_CONCURRENCY, JOB_MAX_ATTEMPTS, JOB_POLL_INTERVAL_MS,
  JOB_RETRY_BASE_MS, JOB_STALE_AFTER_MS, SHUTDOWN_GRACE_MS
} = require('../shared/runtime');
const logger = require('../shared/logger');
const { getCorrelationId } = require('../shared/requestContext');
const metrics = require('../shared/metrics');
const { jobRepository } = require('../shared/jobRepository');

class ReportJobQueue {
  constructor({
    repository = jobRepository,
    concurrency = EXPORT_JOB_CONCURRENCY,
    pollIntervalMs = JOB_POLL_INTERVAL_MS,
    retryBaseMs = JOB_RETRY_BASE_MS,
    staleAfterMs = JOB_STALE_AFTER_MS,
    maxAttempts = JOB_MAX_ATTEMPTS,
    shutdownGraceMs = SHUTDOWN_GRACE_MS,
    workerId = `${os.hostname()}:${process.pid}`,
    log = logger,
    loadReportsService = () => require('./service'),
    loadExportMarketsService = () => require('../shared/exportMarkets'),
    loadEvidenceProcessor = () => require('../shared/evidenceProcessor'),
    loadProductsService = () => require('../shared/productsService')
  } = {}) {
    this.repository = repository;
    this.concurrency = concurrency;
    this.pollIntervalMs = pollIntervalMs;
    this.retryBaseMs = retryBaseMs;
    this.staleAfterMs = staleAfterMs;
    this.maxAttempts = maxAttempts;
    this.shutdownGraceMs = shutdownGraceMs;
    this.workerId = workerId;
    this.log = log;
    this.loadReportsService = loadReportsService;
    this.loadExportMarketsService = loadExportMarketsService;
    this.loadEvidenceProcessor = loadEvidenceProcessor;
    this.loadProductsService = loadProductsService;
    this.active = new Set();
    this.timer = null;
    this.initPromise = null;
    this.tickPromise = null;
    this.accepting = false;
  }

  _taskKey(task) {
    return task.type === 'evidence_process'
      ? `evidence:${task.evidenceId}`
      : `report:${task.reportId}`;
  }

  _rowToTask(row) {
    if (row.report_type === 'dataset_export') {
      return {
        type: 'dataset_export', reportId: row.id, companyId: row.company_id,
        datasetType: row.dataset_type, fileFormat: row.file_format
      };
    }
    if (row.report_type === 'compliance' && row.file_format !== 'pdf') {
      return { type: 'market_compliance_report', reportId: row.id, companyId: row.company_id };
    }
    return { type: 'manual_report', reportId: row.id, companyId: row.company_id };
  }

  async initialize() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const recovered = await this.repository.recoverStale(this.staleAfterMs);
        const [reports, evidence] = await Promise.all([
          this.repository.backfillReports(this.maxAttempts),
          this.repository.backfillEvidence(this.maxAttempts)
        ]);
        this.accepting = true;
        this.timer = setInterval(() => this._scheduleTick(), this.pollIntervalMs);
        this.timer.unref?.();
        this.log.info(
          { recovered, backfilledReports: reports, backfilledEvidence: evidence },
          '[job-queue] Durable worker initialized'
        );
        this._scheduleTick();
      })().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  async enqueue(task) {
    const receipt = await this.enqueueWithReceipt(task);
    return receipt.accepted;
  }

  async enqueueWithReceipt(task) {
    if (!task?.type || (!task.idempotencyKey && !task.reportId && !task.evidenceId)) {
      return { accepted: false, id: null, status: 'rejected' };
    }
    const receipt = await this.repository.enqueue({
      type: task.type,
      companyId: task.companyId,
      idempotencyKey: task.idempotencyKey || this._taskKey(task),
      payload: task,
      maxAttempts: task.maxAttempts || this.maxAttempts,
      correlationId: task.correlationId || getCorrelationId()
    });
    metrics.increment('weavecarbon_jobs_enqueued_total', {
      kind: task.type, accepted: String(receipt.accepted)
    });
    this._scheduleTick();
    return receipt;
  }

  isReady() {
    return Boolean(this.initPromise && this.accepting);
  }

  getCounts() {
    return this.repository.counts();
  }

  _scheduleTick() {
    if (!this.accepting || this.tickPromise) return;
    this.tickPromise = this._tick()
      .catch((error) => this.log.error({ err: error }, '[job-queue] Dispatch failed'))
      .finally(() => { this.tickPromise = null; });
  }

  async _tick() {
    while (this.accepting && this.active.size < this.concurrency) {
      const job = await this.repository.claimNext(this.workerId);
      if (!job) break;
      const execution = this._execute(job).finally(() => {
        this.active.delete(execution);
        metrics.setGauge('weavecarbon_jobs_active', {}, this.active.size);
        this._scheduleTick();
      });
      this.active.add(execution);
      metrics.setGauge('weavecarbon_jobs_active', {}, this.active.size);
    }
  }

  async _execute(job) {
    const task = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const startedAt = Date.now();
    try {
      const result = await this._runTask(task);
      await this.repository.complete(job.id, result);
      metrics.increment('weavecarbon_jobs_completed_total', { kind: job.kind });
      this.log.info({
        jobId: job.id, kind: job.kind, attempts: job.attempts,
        durationMs: Date.now() - startedAt, correlationId: job.correlation_id
      }, '[job-queue] Job completed');
    } catch (error) {
      const delayMs = this.retryBaseMs * (2 ** Math.max(0, Number(job.attempts) - 1));
      const status = await this.repository.fail(job, String(error?.message || error), delayMs);
      metrics.increment('weavecarbon_jobs_failed_total', { kind: job.kind, status });
      this.log.error({
        err: error, jobId: job.id, kind: job.kind, attempts: job.attempts,
        nextStatus: status, correlationId: job.correlation_id
      }, '[job-queue] Job failed');
    }
  }

  async _runTask(task) {
    switch (task.type) {
      case 'dataset_export':
        await this.loadReportsService()._generateRealExport(
          task.reportId, task.companyId, task.datasetType, task.fileFormat
        );
        return;
      case 'market_compliance_report':
        await this.loadExportMarketsService()._simulateComplianceReport(task.reportId, task.companyId);
        return;
      case 'evidence_process':
        await this.loadEvidenceProcessor().processStoredEvidence(task);
        return;
      case 'products_bulk_import':
        return this.loadProductsService().bulkImport(
          task.companyId, task.userId, task.rows, task.saveMode
        );
      case 'manual_report':
        await this.loadReportsService()._generateRealReport(task.reportId, task.companyId);
        return;
      default:
        throw new Error(`Unsupported operational job type: ${task.type}`);
    }
  }

  async stop() {
    this.accepting = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.tickPromise) await this.tickPromise;
    if (this.active.size === 0) return true;

    let timeout;
    const drained = Promise.allSettled([...this.active]).then(() => true);
    const expired = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), this.shutdownGraceMs);
    });
    const result = await Promise.race([drained, expired]);
    clearTimeout(timeout);
    return result;
  }
}

const reportJobQueue = new ReportJobQueue();

module.exports = reportJobQueue;
module.exports.ReportJobQueue = ReportJobQueue;
module.exports.createReportJobQueue = (dependencies) => new ReportJobQueue(dependencies);
