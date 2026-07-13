const toFloat = (value) => parseFloat(value || 0);

const parseCoordinate = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapShipmentSummaryRow = (row) => ({
  id: row.id,
  referenceNumber: row.reference_number,
  status: row.status,
  origin: {
    country: row.origin_country,
    city: row.origin_city,
    address: row.origin_address,
    lat: parseCoordinate(row.origin_lat),
    lng: parseCoordinate(row.origin_lng),
  },
  destination: {
    country: row.destination_country,
    city: row.destination_city,
    address: row.destination_address,
    lat: parseCoordinate(row.destination_lat),
    lng: parseCoordinate(row.destination_lng),
  },
  totalWeightKg: toFloat(row.total_weight_kg),
  totalDistanceKm: toFloat(row.total_distance_km),
  totalCo2e: toFloat(row.total_co2e),
  estimatedArrival: row.estimated_arrival,
  estimatedArrivalAt: row.estimated_arrival_at,
  actualArrival: row.actual_arrival,
  actualArrivalAt: row.actual_arrival_at,
  pendingUntil: row.pending_until,
  simulationEnabled: row.simulation_enabled === true,
  legsCount: Number.parseInt(row.legs_count || 0, 10),
  productsCount: Number.parseInt(row.products_count || 0, 10),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapShipmentMutationRow = (row) => ({
  id: row.id,
  referenceNumber: row.reference_number || null,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  estimatedArrival: row.estimated_arrival,
  estimatedArrivalAt: row.estimated_arrival_at,
  actualArrival: row.actual_arrival,
  actualArrivalAt: row.actual_arrival_at,
  pendingUntil: row.pending_until,
  simulationEnabled: row.simulation_enabled === true,
});

const mapShipmentLeg = (row) => ({
  id: row.id,
  legOrder: row.leg_order,
  transportMode: row.transport_mode,
  originLocation: row.origin_location,
  destinationLocation: row.destination_location,
  distanceKm: toFloat(row.distance_km),
  durationHours: row.duration_hours != null ? toFloat(row.duration_hours) : null,
  co2e: toFloat(row.co2e),
  emissionFactorUsed: row.emission_factor_used != null ? toFloat(row.emission_factor_used) : null,
  carrierName: row.carrier_name || null,
  vehicleType: row.vehicle_type || null,
});

const mapShipmentProduct = (row) => ({
  id: row.id,
  productId: row.product_id,
  quantity: toFloat(row.quantity),
  weightKg: toFloat(row.weight_kg),
  allocatedCo2e: toFloat(row.allocated_co2e),
  sku: row.sku || null,
  productName: row.product_name || null,
});

module.exports = {
  toFloat,
  parseCoordinate,
  mapShipmentSummaryRow,
  mapShipmentMutationRow,
  mapShipmentLeg,
  mapShipmentProduct
};
