const services = {
  get bulkImportExecution() {
    return require('./services/bulkImportExecution');
  },
  get bulkImportValidation() {
    return require('./services/bulkImportValidation');
  },
  get carbonScoring() {
    return require('./services/carbonScoring');
  },
  get mappers() {
    return require('./services/mappers');
  },
  get payloadExtraction() {
    return require('./services/payloadExtraction');
  },
  get shared() {
    return require('./services/shared');
  },
  get shipmentSync() {
    return require('./services/shipmentSync');
  }
};

module.exports = {
  services,
  get productsService() {
    return require('./service');
  },
  get ProductsService() {
    return require('./service').ProductsService;
  },
  get createProductsService() {
    return require('./service').createProductsService;
  },
  get productsValidators() {
    return require('./validation');
  },
  get productsRouter() {
    return require('./routes');
  }
};
