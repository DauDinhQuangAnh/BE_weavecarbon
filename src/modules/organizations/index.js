const {
  companyMembersService,
  createCompanyMembersService
} = require('./companyMembersService');
const companyMembersValidators = require('./companyMembersValidators');

module.exports = {
  companyMembersService,
  createCompanyMembersService,
  companyMembersValidators,
  get companyMembersRouter() {
    return require('./companyMembersRoutes');
  }
};
