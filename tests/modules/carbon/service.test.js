jest.mock('../../../src/modules/shared/database', () => (
  require('../../helpers/mockPool').createMockPool()
));

const { createCarbonService } = require('../../../src/modules/carbon');
const inputFixtures = require('../../fixtures/carbon/v1/inputs.json');

function createRepository() {
  return {
    listCalculations: jest.fn(),
    createCalculation: jest.fn(),
    listElectricityInvoices: jest.fn(),
    createElectricityInvoice: jest.fn(),
    updateElectricityInvoice: jest.fn(),
    deleteElectricityInvoice: jest.fn(),
    listFuelInvoices: jest.fn(),
    createFuelInvoice: jest.fn(),
    updateFuelInvoice: jest.fn(),
    deleteFuelInvoice: jest.fn()
  };
}

describe('carbonService', () => {
  test('maps calculation rows and pagination without changing values', async () => {
    const repository = createRepository();
    repository.listCalculations.mockResolvedValue({
      rows: [{
        id: 'calc-1',
        product_id: 'product-1',
        shipment_id: null,
        calculation_type: 'product',
        total_co2e: '12.5',
        emission_factor_version: '2024',
        created_at: 'created'
      }],
      total: 6
    });
    const service = createCarbonService({ repository });

    const result = await service.listCalculations({
      companyId: 'company-1',
      productId: 'product-1',
      calculationType: 'product',
      page: 2,
      limit: 5
    });

    expect(repository.listCalculations).toHaveBeenCalledWith({
      companyId: 'company-1',
      productId: 'product-1',
      calculationType: 'product',
      limit: 5,
      offset: 5
    });
    expect(result).toEqual({
      data: [expect.objectContaining({
        id: 'calc-1',
        productId: 'product-1',
        calculationType: 'product',
        totalCo2e: '12.5',
        emissionFactorVersion: '2024'
      })],
      meta: { total: 6, page: 2, limit: 5 }
    });
  });

  test('recomputes a calculation and ignores tampered client totals before persistence', async () => {
    const repository = createRepository();
    repository.createCalculation.mockImplementation(async (values) => ({
      id: 'calc-1',
      product_id: values.productId,
      shipment_id: values.shipmentId,
      calculation_type: values.calculationType,
      materials_co2e: values.materialsCo2e,
      production_co2e: values.productionCo2e,
      transport_co2e: values.transportCo2e,
      packaging_co2e: values.packagingCo2e,
      total_co2e: values.totalCo2e,
      emission_factor_version: values.emissionFactorVersion
    }));
    const service = createCarbonService({ repository });

    await service.createCalculation({
      companyId: 'company-1',
      userId: 'user-1',
      payload: {
        productId: 'product-1',
        calculation_type: 'product',
        carbon_input: inputFixtures.cases[0].input,
        totalCo2e: 999999,
        materialsCo2e: 999999
      }
    });

    expect(repository.createCalculation).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      userId: 'user-1',
      productId: 'product-1',
      shipmentId: null,
      calculationType: 'product',
      materialsCo2e: 2.864,
      productionCo2e: 1.591,
      transportCo2e: 0.106,
      packagingCo2e: 0.017,
      totalCo2e: 4.577,
      methodology: 'WeaveCarbon Attributional Textile PCF v2.1 - climate-only partial CFP',
      emissionFactorVersion: 'scope-quality-rss-1.0.0',
      engineVersion: 'scope-quality-rss-1.0.0',
      methodologyVersion: 'WeaveCarbon Attributional Textile PCF v2.1 - climate-only partial CFP',
      factorRegistryVersion: expect.stringMatching(/^factors-v1:[a-f0-9]{64}$/),
      gwpBasis: 'IPCC_AR5_100y',
      calculatedAt: expect.stringMatching(/^2026-|^20/),
      canonicalInputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputSnapshot: inputFixtures.cases[0].input,
      factorSnapshot: expect.arrayContaining([
        expect.objectContaining({ factorId: 'cat-cotton-100', value: 8 })
      ]),
      assumptions: expect.arrayContaining([
        expect.stringContaining('Boundary: climate-only partial CFP')
      ])
    }));
  });

  test('rejects an incomplete calculation before persistence', async () => {
    const repository = createRepository();
    const service = createCarbonService({ repository });

    await expect(service.createCalculation({
      companyId: 'company-1',
      userId: 'user-1',
      payload: { calculation_type: 'product' }
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'calculation_type and carbon_input are required'
    });
    expect(repository.createCalculation).not.toHaveBeenCalled();
  });

  test('applies the existing electricity defaults', async () => {
    const repository = createRepository();
    repository.createElectricityInvoice.mockResolvedValue({ id: 'electricity-1' });
    const service = createCarbonService({ repository });

    await service.createElectricityInvoice({
      companyId: 'company-1',
      userId: 'user-1',
      payload: { billing_period: '2026-08', kwh: 100 }
    });

    expect(repository.createElectricityInvoice).toHaveBeenCalledWith({
      companyId: 'company-1',
      userId: 'user-1',
      facilityName: 'Main Facility',
      billingPeriod: '2026-08',
      kwh: 100,
      emissionFactor: 0.429,
      emissionFactorSource: 'VN Ministry of Natural Resources 2024',
      status: 'uploaded',
      evidenceDocumentId: null
    });
  });

  test('rejects an incomplete electricity invoice before persistence', async () => {
    const repository = createRepository();
    const service = createCarbonService({ repository });

    await expect(service.createElectricityInvoice({
      companyId: 'company-1',
      userId: 'user-1',
      payload: { billing_period: '2026-08' }
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'billing_period and kwh are required'
    });
    expect(repository.createElectricityInvoice).not.toHaveBeenCalled();
  });

  test('computes fuel CO2e with the existing default factor', async () => {
    const repository = createRepository();
    repository.createFuelInvoice.mockResolvedValue({ id: 'fuel-1' });
    const service = createCarbonService({ repository });

    await service.createFuelInvoice({
      companyId: 'company-1',
      userId: null,
      payload: { billing_period: '2026-08', fuel_type: 'diesel', quantity_liters: '10' }
    });

    expect(repository.createFuelInvoice).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      fuelType: 'diesel',
      quantityLiters: '10',
      emissionFactor: 2.688,
      status: 'uploaded'
    }));
    expect(repository.createFuelInvoice.mock.calls[0][0].scope1Co2e).toBeCloseTo(26.88);
  });

  test('preserves explicit fuel factor and CO2e overrides', async () => {
    const repository = createRepository();
    repository.createFuelInvoice.mockResolvedValue({ id: 'fuel-1' });
    const service = createCarbonService({ repository });

    await service.createFuelInvoice({
      companyId: 'company-1',
      userId: 'user-1',
      payload: {
        billing_period: '2026-08',
        fuel_type: 'other',
        quantity_liters: 10,
        emission_factor_kg_per_liter: 3,
        scope1_co2e_kg: 7
      }
    });

    expect(repository.createFuelInvoice).toHaveBeenCalledWith(expect.objectContaining({
      emissionFactor: 3,
      scope1Co2e: 7
    }));
  });

  test('rejects an incomplete fuel invoice before persistence', async () => {
    const repository = createRepository();
    const service = createCarbonService({ repository });

    await expect(service.createFuelInvoice({
      companyId: 'company-1',
      userId: 'user-1',
      payload: { billing_period: '2026-08' }
    })).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'billing_period and quantity_liters are required'
    });
    expect(repository.createFuelInvoice).not.toHaveBeenCalled();
  });
});
