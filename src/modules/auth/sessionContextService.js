const { accountProvisioningService } = require('./accountProvisioningService');
const { userRepository } = require('./userRepository');
const { verificationRepository } = require('./verificationRepository');

function createSessionContextService({
  accounts = accountProvisioningService,
  users = userRepository,
  verification = verificationRepository
} = {}) {
  return {
    async resolve(user, { updateMembershipLogin = false } = {}) {
      let company = null;
      let companyMembership = null;
      let companyIdForToken = user.company_id;
      const membership = await accounts.getPrimaryCompanyMembership(user.id);

      if (membership) {
        company = {
          id: membership.company_id,
          name: membership.company_name,
          business_type: membership.business_type,
          current_plan: membership.current_plan,
          domestic_market: membership.domestic_market,
          target_markets: membership.target_markets
        };
        companyMembership = {
          company_id: membership.company_id,
          role: membership.company_role,
          status: membership.member_status,
          is_root: membership.company_role === 'admin',
          membership_inferred: false
        };
        companyIdForToken = membership.company_id;

        if (updateMembershipLogin && membership.member_status === 'active') {
          await verification.markMembershipLoggedIn(membership.company_id, user.id);
        }
      } else if (user.company_id) {
        company = await users.findCompanyById(user.company_id);
        if (company) {
          companyMembership = {
            company_id: company.id,
            role: 'admin',
            status: 'active',
            is_root: true,
            membership_inferred: true
          };
          companyIdForToken = company.id;
        }
      }

      return { company, companyMembership, companyIdForToken };
    }
  };
}

module.exports = {
  createSessionContextService,
  sessionContextService: createSessionContextService()
};
