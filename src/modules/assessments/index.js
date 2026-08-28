module.exports = {
  get batchesService() {
    return require('./batchesService');
  },
  get BatchesService() {
    return require('./batchesService').BatchesService;
  },
  get createBatchesService() {
    return require('./batchesService').createBatchesService;
  },
  get batchesValidators() {
    return require('./batchesValidators');
  },
  get batchesRouter() {
    return require('./batchesRoutes');
  }
};
