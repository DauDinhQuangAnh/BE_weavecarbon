const { createSupplierRequestsService } = require('../../../src/modules/suppliers-compliance/service');

const transportRow = {
  id: 'supplier-1',
  supplier_name: 'Green Textiles',
  supplier_email: 'data@green.example',
  material_supplied: 'Cotton',
  required_data: ['energy'],
  deadline: '2026-09-30',
  status: 'draft',
  sent_at: null,
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z'
};

const expectedSupplier = {
  id: 'supplier-1',
  supplierName: 'Green Textiles',
  supplierEmail: 'data@green.example',
  materialSupplied: 'Cotton',
  requiredData: ['energy'],
  deadline: '2026-09-30',
  status: 'draft',
  sentAt: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
};

function createHarness(overrides = {}) {
  const repository = {
    findMany: jest.fn().mockResolvedValue([transportRow]),
    create: jest.fn().mockResolvedValue(transportRow),
    findUpdateContext: jest.fn().mockResolvedValue({
      status: 'draft',
      supplier_name: 'Green Textiles'
    }),
    update: jest.fn().mockResolvedValue({ ...transportRow, status: 'sent' }),
    remove: jest.fn().mockResolvedValue('supplier-1'),
    ...overrides
  };
  const audit = jest.fn().mockResolvedValue(undefined);
  const service = createSupplierRequestsService({
    supplierRequestsRepository: repository,
    audit
  });
  return { service, repository, audit };
}

describe('suppliers/compliance reference module service', () => {
  test('maps repository rows to the unchanged public payload', async () => {
    const { service, repository } = createHarness();
    await expect(service.list({ companyId: 'company-1', limit: 20, offset: 0 }))
      .resolves.toEqual([expectedSupplier]);
    expect(repository.findMany).toHaveBeenCalledWith({
      companyId: 'company-1',
      limit: 20,
      offset: 0
    });
  });

  test('creates a supplier and retains the existing audit event', async () => {
    const { service, repository, audit } = createHarness();
    const supplier = {
      supplierName: 'Green Textiles',
      supplierEmail: 'data@green.example',
      materialSupplied: 'Cotton',
      requiredData: ['energy'],
      deadline: '2026-09-30',
      status: 'draft'
    };

    await expect(service.create({ companyId: 'company-1', userId: 'user-1', supplier }))
      .resolves.toEqual(expectedSupplier);
    expect(repository.create).toHaveBeenCalledWith({ companyId: 'company-1', ...supplier });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      userId: 'user-1',
      changedField: 'supplier_request.created',
      newValue: 'supplier-1'
    }));
  });

  test('updates a supplier and retains the sent audit event', async () => {
    const { service, audit } = createHarness();
    await expect(service.update({
      companyId: 'company-1',
      userId: 'user-1',
      id: 'supplier-1',
      changes: { status: 'sent', sentAt: null, deadline: null, requiredData: null }
    })).resolves.toEqual({ ...expectedSupplier, status: 'sent' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      changedField: 'supplier_request.sent',
      oldValue: 'draft',
      newValue: 'sent'
    }));
  });

  test('returns null without auditing when an update target does not exist', async () => {
    const { service, audit } = createHarness({ update: jest.fn().mockResolvedValue(null) });
    await expect(service.update({
      companyId: 'company-1',
      userId: 'user-1',
      id: 'missing',
      changes: { status: null, sentAt: null, deadline: null, requiredData: null }
    })).resolves.toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  test('returns the deleted identifier unchanged', async () => {
    const { service, repository } = createHarness();
    await expect(service.remove({ companyId: 'company-1', id: 'supplier-1' }))
      .resolves.toBe('supplier-1');
    expect(repository.remove).toHaveBeenCalledWith({ companyId: 'company-1', id: 'supplier-1' });
  });
});
