module.exports = {
  get reportsService() {
    return require('./service');
  },
  get ReportsService() {
    return require('./service').ReportsService;
  },
  get createReportsService() {
    return require('./service').createReportsService;
  },
  get reportsRouter() {
    return require('./routes');
  },
  get validators() {
    return require('./validation');
  },
  get pdfReportService() {
    return require('./pdfService');
  },
  get createPdfReportService() {
    return require('./pdfService').createPdfReportService;
  },
  get reportJobQueue() {
    return require('./jobQueue');
  },
  get ReportJobQueue() {
    return require('./jobQueue').ReportJobQueue;
  },
  get createReportJobQueue() {
    return require('./jobQueue').createReportJobQueue;
  },
  get helpers() {
    return require('./helpers');
  }
};
