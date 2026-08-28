const repository = require('./repository');
const { logAuditTrail } = require('../shared/auditing');

const formatSupplier = (row) => ({
  id: row.id,
  supplierName: row.supplier_name,
  supplierEmail: row.supplier_email,
  materialSupplied: row.material_supplied,
  requiredData: row.required_data,
  deadline: row.deadline,
  status: row.status,
  sentAt: row.sent_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

function createSupplierRequestsService({ supplierRequestsRepository = repository, audit = logAuditTrail } = {}) {
  return {
    async list({ companyId, limit, offset }) {
      const rows = await supplierRequestsRepository.findMany({ companyId, limit, offset });
      return rows.map(formatSupplier);
    },

    async create({ companyId, userId, supplier }) {
      const row = await supplierRequestsRepository.create({ companyId, ...supplier });
      await audit({
        companyId,
        userId,
        dataGroup: 'suppliers',
        changedField: 'supplier_request.created',
        newValue: row?.id || supplier.supplierEmail,
        reason: 'supplier_request.create',
        notes: `Created supplier request for ${supplier.supplierName} (${supplier.supplierEmail})`
      });
      return formatSupplier(row);
    },

    async update({ companyId, userId, id, changes }) {
      const previous = await supplierRequestsRepository.findUpdateContext({ id, companyId });
      const row = await supplierRequestsRepository.update({ id, companyId, ...changes });
      if (!row) return null;

      await audit({
        companyId,
        userId,
        dataGroup: 'suppliers',
        changedField: changes.status === 'sent' ? 'supplier_request.sent' : 'supplier_request.updated',
        oldValue: previous?.status || null,
        newValue: row.status,
        reason: 'supplier_request.update',
        notes: `${changes.status === 'sent' ? 'Sent' : 'Updated'} supplier request for ${row.supplier_name || previous?.supplier_name || id}`
      });
      return formatSupplier(row);
    },

    async remove({ companyId, id }) {
      return supplierRequestsRepository.remove({ companyId, id });
    }
  };
}

module.exports = {
  createSupplierRequestsService,
  formatSupplier,
  supplierRequestsService: createSupplierRequestsService()
};
