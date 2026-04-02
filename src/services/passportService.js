const pool = require('../config/database');
const productsService = require('./productsService');
const logisticsService = require('./logisticsService');

class PassportService {
  async getPublicPassportPayload(identifier) {
    const normalizedIdentifier = String(identifier || '').trim();
    if (!normalizedIdentifier) {
      return null;
    }

    const productLookupResult = await pool.query(
      `
        SELECT
          p.id,
          p.company_id,
          latest_shipment.shipment_id
        FROM public.products p
        LEFT JOIN LATERAL (
          SELECT
            sp.shipment_id
          FROM public.shipment_products sp
          INNER JOIN public.shipments s ON s.id = sp.shipment_id
          WHERE sp.product_id = p.id
            AND s.company_id = p.company_id
          ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
          LIMIT 1
        ) latest_shipment ON TRUE
        WHERE p.status = 'active'
          AND (
            p.id::text = $1
            OR LOWER(p.sku) = LOWER($1)
          )
        LIMIT 1
      `,
      [normalizedIdentifier]
    );

    if (productLookupResult.rows.length === 0) {
      return null;
    }

    const productRef = productLookupResult.rows[0];
    const product = await productsService.getProductById(productRef.id, productRef.company_id);
    if (!product) {
      return null;
    }

    let shipment = null;
    if (productRef.shipment_id) {
      shipment = await logisticsService.getShipmentById(
        productRef.shipment_id,
        productRef.company_id
      );
    }

    return {
      product,
      shipment
    };
  }
}

module.exports = new PassportService();
