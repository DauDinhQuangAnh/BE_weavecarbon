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
});
