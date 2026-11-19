const { PassportService } = require('../../src/services/passportService');

describe('public passport claim containment', () => {
  test('redacts raw carbon and certification data while returning approved R18 copy', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'product-1', company_id: 'company-1', shipment_id: 'shipment-1' }] }) };
    const products = { getProductById: jest.fn().mockResolvedValue({ id: 'product-1', productCode: 'SKU-1',
      productName: 'Shirt', productType: 'shirt', status: 'published', createdAt: '2026-01-01', updatedAt: '2026-01-02',
      materials: [{ materialType: 'cotton', percentage: 100, certifications: ['self-claimed-green'] }],
      carbonResults: { perProduct: { total: 4.5 } }, carbonAuthority: { canonicalInputHash: 'a'.repeat(64) } }) };
    const logistics = { getShipmentById: jest.fn().mockResolvedValue({ id: 'shipment-1', referenceNumber: 'SHIP-1',
      destination: { country: 'NL' }, totalCo2e: 50, legs: [{ id: 'leg-1', co2e: 50, emissionFactorUsed: 1 }],
      products: [{ id: 'sp-1', productId: 'product-1', allocatedCo2e: 50 }] }) };
    const publicClaims = { resolvePassportClaims: jest.fn().mockResolvedValue([{ dossierId: 'dossier-1',
      claimReference: 'CLAIM-1', exactClaimText: 'Approved exact text.' }]) };
    const result = await new PassportService({ database, products, logistics, publicClaims }).getPublicPassportPayload('SKU-1');
    expect(result.environmentalClaimStatus).toBe('approved_current');
    expect(result.product).not.toHaveProperty('carbonResults');
    expect(result.product.materials[0]).not.toHaveProperty('certifications');
    expect(result.shipment).not.toHaveProperty('totalCo2e');
    expect(result.shipment.legs[0]).not.toHaveProperty('co2e');
    expect(result.environmentalClaims[0].dossierId).toBe('dossier-1');
  });

  const build = (linkedRows) => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'product-1', company_id: 'company-1', shipment_id: 'latest-shipment' }] })
      .mockResolvedValueOnce({ rows: linkedRows }) };
    const products = { getProductById: jest.fn().mockResolvedValue({ id: 'product-1', productCode: 'SKU-1',
      productName: 'Shirt', status: 'published', materials: [], transportLegs: [] }) };
    const logistics = { getShipmentById: jest.fn().mockImplementation(async (id) => ({ id, legs: [], products: [] })) };
    const publicClaims = { resolvePassportClaims: jest.fn().mockResolvedValue([]) };
    return { database, logistics, service: new PassportService({ database, products, logistics, publicClaims }) };
  };
  const pinned = '11111111-1111-4111-8111-111111111111';

  test('uses the shipment printed on the QR when it contains the product', async () => {
    const { database, logistics, service } = build([{ shipment_id: pinned }]);
    const result = await service.getPublicPassportPayload('product-1', { shipmentId: pinned });
    expect(database.query.mock.calls[1][1]).toEqual(['product-1', pinned, 'company-1']);
    expect(logistics.getShipmentById).toHaveBeenCalledWith(pinned, 'company-1');
    expect(result.shipment.id).toBe(pinned);
  });

  test('falls back to the latest shipment when the requested one is not linked', async () => {
    const { logistics, service } = build([]);
    const result = await service.getPublicPassportPayload('product-1', { shipmentId: pinned });
    expect(logistics.getShipmentById).toHaveBeenCalledWith('latest-shipment', 'company-1');
    expect(result.shipment.id).toBe('latest-shipment');
  });

  test('ignores malformed shipment ids without querying', async () => {
    const { database, service } = build([]);
    await service.getPublicPassportPayload('product-1', { shipmentId: "x' OR 1=1" });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});
