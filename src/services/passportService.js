const pool = require('../config/database');
const productsService = require('./productsService');
const logisticsService = require('./logisticsService');
const publicEnvironmentalClaimService = require('./publicEnvironmentalClaimService');

function array(value) { return Array.isArray(value) ? value : []; }
function publicProduct(product) {
  return {
    id: product.id, productCode: product.productCode, productName: product.productName,
    productType: product.productType, weightPerUnit: product.weightPerUnit,
    quantity: product.quantity, status: product.status, createdAt: product.createdAt, updatedAt: product.updatedAt,
    destinationMarket: product.destinationMarket,
    manufacturingLocation: product.manufacturingLocation,
    originAddress: product.originAddress, destinationAddress: product.destinationAddress,
    materials: array(product.materials).map((item) => ({
      materialType: item.materialType, percentage: item.percentage, weight: item.weight
    })),
    transportLegs: array(product.transportLegs).map((item) => ({
      id: item.id, mode: item.mode, origin: item.origin, destination: item.destination,
      estimatedDistance: item.estimatedDistance
    }))
  };
}

function publicShipment(shipment) {
  if (!shipment) return null;
  return {
    id: shipment.id, referenceNumber: shipment.referenceNumber, status: shipment.status,
    origin: shipment.origin, destination: shipment.destination, totalWeightKg: shipment.totalWeightKg,
    totalDistanceKm: shipment.totalDistanceKm, pendingUntil: shipment.pendingUntil,
    estimatedArrival: shipment.estimatedArrival, estimatedArrivalAt: shipment.estimatedArrivalAt,
    actualArrival: shipment.actualArrival, actualArrivalAt: shipment.actualArrivalAt,
    simulationEnabled: shipment.simulationEnabled, createdAt: shipment.createdAt, updatedAt: shipment.updatedAt,
    legs: array(shipment.legs).map((item) => ({
      id: item.id, legOrder: item.legOrder, transportMode: item.transportMode,
      originLocation: item.originLocation, destinationLocation: item.destinationLocation,
      distanceKm: item.distanceKm, durationHours: item.durationHours, carrierName: item.carrierName,
      vehicleType: item.vehicleType
    })),
    products: array(shipment.products).map((item) => ({
      id: item.id, productId: item.productId, quantity: item.quantity, weightKg: item.weightKg,
      sku: item.sku, productName: item.productName
    }))
  };
}

class PassportService {
  constructor({ database = pool, products = productsService, logistics = logisticsService,
    publicClaims = publicEnvironmentalClaimService } = {}) {
    this.database = database; this.products = products; this.logistics = logistics; this.publicClaims = publicClaims;
  }

  async getPublicPassportPayload(identifier) {
    const normalizedIdentifier = String(identifier || '').trim();
    if (!normalizedIdentifier) {
      return null;
    }

    const productLookupResult = await this.database.query(
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
    const product = await this.products.getProductById(productRef.id, productRef.company_id);
    if (!product) {
      return null;
    }

    let shipment = null;
    if (productRef.shipment_id) {
      shipment = await this.logistics.getShipmentById(
        productRef.shipment_id,
        productRef.company_id
      );
    }

    const environmentalClaims = await this.publicClaims.resolvePassportClaims({
      companyId: productRef.company_id, shipmentId: productRef.shipment_id,
      shipmentReference: shipment?.referenceNumber, destinationCountry: shipment?.destination?.country,
      productId: product.id, productSku: product.productCode,
      calculationSha256: product.carbonAuthority?.canonicalInputHash
    });

    return { product: publicProduct(product), shipment: publicShipment(shipment),
      environmentalClaimStatus: environmentalClaims.length ? 'approved_current' : 'not_authorized',
      environmentalClaims };
  }
}

module.exports = new PassportService();
module.exports.PassportService = PassportService;
module.exports.publicProduct = publicProduct;
module.exports.publicShipment = publicShipment;
