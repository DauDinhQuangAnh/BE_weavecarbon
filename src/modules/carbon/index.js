module.exports = {
  get calculateAuthoritativeProductCarbon() {
    return require('./authoritativeCalculation').calculateAuthoritativeProductCarbon;
  },
  get stripClientCarbonOutputs() {
    return require('./authoritativeCalculation').stripClientCarbonOutputs;
  },
  get buildCarbonAuthorityReference() {
    return require('./authorityReference').buildCarbonAuthorityReference;
  },
  get buildAuthoritativeCarbonResult() {
    return require('./authorityReference').buildAuthoritativeCarbonResult;
  },
  get loadAuthoritativeProductCarbon() {
    return require('./authorityReference').loadAuthoritativeProductCarbon;
  },
  get requireAuthoritativeProductCarbon() {
    return require('./authorityReference').requireAuthoritativeProductCarbon;
  },
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
  },
  get core() {
    return require('./core');
  }
};
