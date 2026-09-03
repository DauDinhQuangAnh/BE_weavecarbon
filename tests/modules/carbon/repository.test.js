jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));

const { createCarbonRepository } = require('../../../src/modules/carbon');

describe('carbonRepository', () => {
  test('scopes calculation filters, page query and count to the company', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'calc-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const repository = createCarbonRepository({ database });

    await expect(repository.listCalculations({
      companyId: 'company-1',
      productId: 'product-1',
      calculationType: 'product',
      limit: 25,
      offset: 50
    })).resolves.toEqual({ rows: [{ id: 'calc-1' }], total: 1 });

    expect(database.query.mock.calls[0][0]).toContain(
      'company_id = $1 AND product_id = $2 AND calculation_type = $3'
    );
    expect(database.query.mock.calls[0][1]).toEqual([
      'company-1', 'product-1', 'product', 25, 50
    ]);
    expect(database.query.mock.calls[1][1]).toEqual([
      'company-1', 'product-1', 'product'
    ]);
  });

  test('writes a calculation with the preserved parameter order', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'calc-1' }] }) };
    const repository = createCarbonRepository({ database });
    const values = {
      companyId: 'company-1',
      productId: 'product-1',
      shipmentId: null,
      calculationType: 'product',
      periodStart: null,
      periodEnd: null,
      materialsCo2e: 1,
      productionCo2e: 2,
      transportCo2e: 3,
      packagingCo2e: 4,
      totalCo2e: 10,
      methodology: 'GHG',
      emissionFactorVersion: '2024',
      engineVersion: 'engine-v1',
      methodologyVersion: 'method-v1',
      factorRegistryVersion: 'factors-v1:test',
      gwpBasis: 'IPCC_AR5_100y',
      calculatedAt: '2026-09-03T00:00:00.000Z',
      canonicalInputHash: 'a'.repeat(64),
      inputSnapshot: { quantity: 1 },
      factorSnapshot: [{ factorId: 'factor-1', value: 10 }],
      assumptions: ['Assumption A'],
      notes: null,
      userId: 'user-1'
    };

    await expect(repository.createCalculation(values)).resolves.toEqual({ id: 'calc-1' });
    expect(database.query.mock.calls[0][1]).toStrictEqual([
      'company-1', 'product-1', null, 'product', null, null,
      1, 2, 3, 4, 10, 'GHG', '2024', null, 'user-1',
      'engine-v1', 'method-v1', 'factors-v1:test', 'IPCC_AR5_100y',
      '2026-09-03T00:00:00.000Z', 'a'.repeat(64),
      JSON.stringify({ quantity: 1 }),
      JSON.stringify([{ factorId: 'factor-1', value: 10 }]),
      JSON.stringify(['Assumption A'])
    ]);
  });

  test('keeps electricity update and delete company-scoped', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'electricity-1' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const repository = createCarbonRepository({ database });

    await expect(repository.updateElectricityInvoice({
      id: 'electricity-1',
      companyId: 'company-1',
      changes: { kwh: 200, status: 'verified' }
    })).resolves.toEqual({ id: 'electricity-1' });
    await expect(repository.deleteElectricityInvoice({
      id: 'electricity-1',
      companyId: 'company-1'
    })).resolves.toBe(true);

    expect(database.query.mock.calls[0][0]).toContain('WHERE id = $1 AND company_id = $2');
    expect(database.query.mock.calls[0][1]).toEqual([
      'electricity-1', 'company-1', undefined, undefined, 200,
      undefined, undefined, 'verified'
    ]);
    expect(database.query.mock.calls[1][1]).toEqual(['electricity-1', 'company-1']);
  });

  test('lists electricity invoices with company-scoped pagination and count', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'electricity-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '7' }] });
    const repository = createCarbonRepository({ database });

    await expect(repository.listElectricityInvoices({
      companyId: 'company-1',
      limit: 20,
      offset: 40
    })).resolves.toEqual({ rows: [{ id: 'electricity-1' }], total: 7 });
    expect(database.query.mock.calls[0][1]).toEqual(['company-1', 20, 40]);
    expect(database.query.mock.calls[1][1]).toEqual(['company-1']);
  });

  test('lists fuel invoices with company-scoped pagination and count', async () => {
    const database = { query: jest.fn() };
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'fuel-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });
    const repository = createCarbonRepository({ database });

    await expect(repository.listFuelInvoices({
      companyId: 'company-1',
      limit: 10,
      offset: 10
    })).resolves.toEqual({ rows: [{ id: 'fuel-1' }], total: 3 });
    expect(database.query.mock.calls[0][1]).toEqual(['company-1', 10, 10]);
    expect(database.query.mock.calls[1][1]).toEqual(['company-1']);
  });

  test('returns false when a company-scoped fuel invoice delete matches no row', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
    const repository = createCarbonRepository({ database });

    await expect(repository.deleteFuelInvoice({
      id: 'fuel-1',
      companyId: 'company-1'
    })).resolves.toBe(false);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND company_id = $2'),
      ['fuel-1', 'company-1']
    );
  });
});
