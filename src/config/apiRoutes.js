const authRoutes = require('../routes/auth');
const dashboardRoutes = require('../routes/dashboard');
const accountRoutes = require('../routes/account');
const subscriptionRoutes = require('../routes/subscription');
const companyMembersRoutes = require('../routes/companyMembers');
const reportsRoutes = require('../routes/reports');
const productsRoutes = require('../routes/products');
const batchesRoutes = require('../routes/batches');
const logisticsRoutes = require('../routes/logistics');
const exportMarketsRoutes = require('../routes/exportMarkets');
const exportV2Routes = require('../routes/exportV2');
const evidenceRoutes = require('../routes/evidence');
const chatRoutes = require('../routes/chat');
const aiConfigRoutes = require('../routes/aiConfig');
const contactRoutes = require('../routes/contact');
const b2cRoutes = require('../routes/b2c');
const b2cAdminRoutes = require('../routes/b2cAdmin');
const passportRoutes = require('../routes/passport');
const suppliersRoutes = require('../routes/suppliers');
const dataGapsRoutes = require('../routes/dataGaps');
const auditTrailRoutes = require('../routes/auditTrail');
const electricityInvoicesRoutes = require('../routes/electricityInvoices');
const fuelInvoicesRoutes = require('../routes/fuelInvoices');
const carbonCalculationsRoutes = require('../routes/carbonCalculations');
const carbonFactorsRoutes = require('../routes/carbonFactors');

const apiRoutes = [
  { basePath: '/api/auth', tag: 'Auth', router: authRoutes },
  { basePath: '/api/dashboard', tag: 'Dashboard', router: dashboardRoutes },
  { basePath: '/api/account', tag: 'Account', router: accountRoutes },
  { basePath: '/api/subscription', tag: 'Subscription', router: subscriptionRoutes },
  { basePath: '/api/company/members', tag: 'Company members', router: companyMembersRoutes },
  { basePath: '/api/reports', tag: 'Reports', router: reportsRoutes },
  { basePath: '/api/products', tag: 'Products', router: productsRoutes },
  { basePath: '/api/product-batches', tag: 'Product batches', router: batchesRoutes },
  { basePath: '/api/logistics', tag: 'Logistics', router: logisticsRoutes },
  { basePath: '/api/export', tag: 'Export', router: exportV2Routes },
  { basePath: '/api/export/markets', tag: 'Export markets', router: exportMarketsRoutes },
  { basePath: '/api/evidence', tag: 'Evidence', router: evidenceRoutes },
  { basePath: '/api/chat', tag: 'Chat', router: chatRoutes },
  { basePath: '/api/ai-config', tag: 'AI configuration', router: aiConfigRoutes },
  { basePath: '/api/contact', tag: 'Contact', router: contactRoutes },
  { basePath: '/api/b2c', tag: 'B2C', router: b2cRoutes },
  { basePath: '/api/b2c-admin', tag: 'B2C administration', router: b2cAdminRoutes },
  { basePath: '/api/passport', tag: 'Passport', router: passportRoutes },
  { basePath: '/api/suppliers', tag: 'Suppliers', router: suppliersRoutes },
  { basePath: '/api/data-gaps', tag: 'Data gaps', router: dataGapsRoutes },
  { basePath: '/api/audit-trail', tag: 'Audit trail', router: auditTrailRoutes },
  { basePath: '/api/electricity-invoices', tag: 'Electricity invoices', router: electricityInvoicesRoutes },
  { basePath: '/api/fuel-invoices', tag: 'Fuel invoices', router: fuelInvoicesRoutes },
  { basePath: '/api/carbon-calculations', tag: 'Carbon calculations', router: carbonCalculationsRoutes },
  { basePath: '/api/carbon-factors', tag: 'Carbon factors', router: carbonFactorsRoutes }
];

module.exports = apiRoutes;
