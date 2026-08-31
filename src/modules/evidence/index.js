module.exports = {
  get evidenceRepository() {
    return require('./repository').evidenceRepository;
  },
  get createEvidenceRepository() {
    return require('./repository').createEvidenceRepository;
  },
  get evidenceService() {
    return require('./service');
  },
  get createEvidenceService() {
    return require('./service').createEvidenceService;
  },
  get fileStorage() {
    return require('./fileStorage');
  },
  get evidenceRouter() {
    return require('./routes');
  }
};
