jest.mock('../../../src/config/database', () =>
  require('../../helpers/mockPool').createMockPool()
);

jest.mock('../../../src/services/shipmentSimulationService', () => ({
  buildShipmentSimulationState: jest.fn(),
  createBusinessError: jest.fn((code, message, statusCode) =>
    Object.assign(new Error(message), { code, statusCode })
  ),
  ensureShipmentSimulationSchema: jest.fn().mockResolvedValue(undefined),
  syncCompanyShipmentSimulation: jest.fn().mockResolvedValue(undefined),
  syncShipmentSimulationById: jest.fn().mockResolvedValue(null),
  toLegacyDate: jest.fn(() => '2026-01-01')
}));

const pool = require('../../../src/config/database');
const logisticsService = require('../../../src/services/logisticsService');

const baseShipment = (status = 'pending') => ({
  id: 'shipment-1',
  company_id: 'company-1',
  reference_number: 'SHIP-1',
  status,
  origin_country: 'VN',
  destination_country: 'DE',
  total_distance_km: '0',
  total_co2e: '0',
  simulation_enabled: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
});

describe('logistics shipment lifecycle guards', () => {
  const client = pool.__mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    pool.connect.mockResolvedValue(client);
  });

  it('rejects metadata edits after a shipment leaves pending', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [baseShipment('delivered')] })
      .mockResolvedValueOnce({});

    await expect(
      logisticsService.updateShipment('shipment-1', 'company-1', {
        reference_number: 'CHANGED'
      })
    ).rejects.toMatchObject({ code: 'SHIPMENT_NOT_EDITABLE', statusCode: 409 });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => /^\s*UPDATE shipments/.test(sql))).toBe(false);
  });

  it.each([
    ['replaceShipmentLegs', 'cancelled', [{
      leg_order: 1,
      transport_mode: 'sea',
      origin_location: 'Hai Phong',
      destination_location: 'Hamburg',
      distance_km: 9000,
      co2e: 100
    }]],
    ['replaceShipmentProducts', 'in_transit', [{
      product_id: 'product-1',
      quantity: 1,
      weight_kg: 10,
      allocated_co2e: 2
    }]]
  ])('rejects %s when status is %s', async (method, status, payload) => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [baseShipment(status)] })
      .mockResolvedValueOnce({});

    await expect(
      logisticsService[method]('shipment-1', 'company-1', payload)
    ).rejects.toMatchObject({ code: 'SHIPMENT_NOT_EDITABLE', statusCode: 409 });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('keeps company scope on the final leg totals update', async () => {
    const updateRow = {
      ...baseShipment('pending'),
      total_distance_km: '9000',
      total_co2e: '100'
    };
    client.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM shipments') && sql.includes('FOR UPDATE')) {
        return { rows: [baseShipment('pending')] };
      }
      if (typeof sql === 'string' && /^\s*UPDATE shipments/.test(sql)) {
        return { rows: [updateRow] };
      }
      return { rows: [] };
    });

    await logisticsService.replaceShipmentLegs('shipment-1', 'company-1', [{
      leg_order: 1,
      transport_mode: 'sea',
      origin_location: 'Hai Phong',
      destination_location: 'Hamburg',
      distance_km: 9000,
      co2e: 100
    }]);

    const updateCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && /^\s*UPDATE shipments/.test(sql)
    );
    expect(updateCall[0]).toContain('WHERE id = $7 AND company_id = $8');
    expect(updateCall[1].slice(-2)).toEqual(['shipment-1', 'company-1']);
  });

  it('returns a conflict when the status changes during a transition', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [baseShipment('pending')] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      logisticsService.updateShipmentStatus('shipment-1', 'company-1', 'in_transit')
    ).rejects.toMatchObject({ code: 'SHIPMENT_STATUS_CONFLICT', statusCode: 409 });

    const updateCall = pool.query.mock.calls[1];
    expect(updateCall[0]).toContain('AND status = $6');
    expect(updateCall[1][5]).toBe('pending');
  });

  it('excludes cancelled shipments from the overview emission estimate', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        total_shipments: '2',
        pending: '0',
        in_transit: '0',
        delivered: '1',
        cancelled: '1',
        total_co2e: '25'
      }]
    });

    const overview = await logisticsService.getLogisticsOverview('company-1');

    expect(pool.query.mock.calls[0][0]).toContain(
      "SUM(total_co2e) FILTER (WHERE status <> 'cancelled')"
    );
    expect(overview.total_co2e).toBe(25);
  });
});
