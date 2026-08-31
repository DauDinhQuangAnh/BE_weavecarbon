const pool = require('../shared/database');
const { EXPORT_JOB_CONCURRENCY } = require('../shared/runtime');
const logger = require('../shared/logger');

class ReportJobQueue {
  constructor({
    database = pool,
    concurrency = EXPORT_JOB_CONCURRENCY,
    log = logger,
    loadReportsService = () => require('./service'),
    loadExportMarketsService = () => require('../shared/exportMarkets')
  } = {}) {
    this.database = database;
    this.concurrency = concurrency;
    this.log = log;
    this.loadReportsService = loadReportsService;
    this.loadExportMarketsService = loadExportMarketsService;
    this.pending = [];
    this.pendingKeys = new Set();
    this.activeKeys = new Set();
    this.activeCount = 0;
    this.initPromise = null;
  }

  _taskKey(task) {
    return `${task.type}:${task.reportId}`;
  }

  _rowToTask(row) {
    if (row.report_type === 'dataset_export') {
      return {
        type: 'dataset_export',
        reportId: row.id,
        companyId: row.company_id,
        datasetType: row.dataset_type,
        fileFormat: row.file_format
      };
    }

    // Legacy compliance report (export-markets simulation) — only when NOT PDF
    if (row.report_type === 'compliance' && row.file_format !== 'pdf') {
      return {
        type: 'market_compliance_report',
        reportId: row.id,
        companyId: row.company_id
      };
    }

    return {
      type: 'manual_report',
      reportId: row.id,
      companyId: row.company_id
    };
  }

  async initialize() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const result = await this.database.query(
          `
            SELECT id, company_id, report_type, dataset_type, file_format
            FROM reports
            WHERE status = 'processing'
              AND COALESCE(storage_key, '') = ''
            ORDER BY created_at ASC
          `
        );

        for (const row of result.rows) {
          this.enqueue(this._rowToTask(row));
        }
      })().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }

    return this.initPromise;
  }

  enqueue(task) {
    if (!task || !task.reportId) {
      return false;
    }

    const key = this._taskKey(task);
    if (this.pendingKeys.has(key) || this.activeKeys.has(key)) {
      return false;
    }

    this.pending.push({ ...task, key });
    this.pendingKeys.add(key);
    setImmediate(() => {
      this._drain().catch((error) => {
        this.log.error({ err: error }, '[report-job-queue] Drain failed');
      });
    });
    return true;
  }

  async _runTask(task) {
    switch (task.type) {
      case 'dataset_export': {
        const reportsService = this.loadReportsService();
        await reportsService._generateRealExport(
          task.reportId,
          task.companyId,
          task.datasetType,
          task.fileFormat
        );
        return;
      }

      case 'market_compliance_report': {
        const exportMarketsService = this.loadExportMarketsService();
        await exportMarketsService._simulateComplianceReport(task.reportId, task.companyId);
        return;
      }

      case 'manual_report':
      default: {
        const reportsService = this.loadReportsService();
        await reportsService._generateRealReport(task.reportId, task.companyId);
      }
    }
  }

  async _drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      this.pendingKeys.delete(task.key);
      this.activeKeys.add(task.key);
      this.activeCount += 1;

      this._runTask(task)
        .catch((error) => {
          this.log.error({ err: error }, `[report-job-queue] Job failed for report ${task.reportId}`);
        })
        .finally(() => {
          this.activeKeys.delete(task.key);
          this.activeCount -= 1;
          if (this.pending.length > 0) {
            setImmediate(() => {
              this._drain().catch((error) => {
                this.log.error({ err: error }, '[report-job-queue] Drain failed');
              });
            });
          }
        });
    }
  }
}

const reportJobQueue = new ReportJobQueue();

module.exports = reportJobQueue;
module.exports.ReportJobQueue = ReportJobQueue;
module.exports.createReportJobQueue = (dependencies) => new ReportJobQueue(dependencies);
