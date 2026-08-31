module.exports = {
  get carbonRepository() {
    return require('./repository').carbonRepository;
  },
  get createCarbonRepository() {
    return require('./repository').createCarbonRepository;
  },
  get carbonService() {
    return require('./service').carbonService;
  },
  get createCarbonService() {
    return require('./service').createCarbonService;
  },
  get carbonCalculationsRouter() {
    return require('./carbonCalculationsRoutes');
  },
  get electricityInvoicesRouter() {
    return require('./electricityInvoicesRoutes');
  },
  get fuelInvoicesRouter() {
    return require('./fuelInvoicesRoutes');
  }
};
