const { carbonRepository } = require('./repository');
const { createAppError } = require('../shared/errors');

const FUEL_EMISSION_FACTORS = {
  diesel: 2.6880,
  petrol: 2.3520,
  lpg: 1.6290,
  cng: 2.7400,
  coal: 2.4200,
  biomass: 0.0000,
  other: 2.5000
};

const formatCalculation = (row) => ({
  id: row.id,
  productId: row.product_id,
  shipmentId: row.shipment_id,
  calculationType: row.calculation_type,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  materialsCo2e: row.materials_co2e,
  productionCo2e: row.production_co2e,
  transportCo2e: row.transport_co2e,
  packagingCo2e: row.packaging_co2e,
  totalCo2e: row.total_co2e,
  methodology: row.methodology,
  emissionFactorVersion: row.emission_factor_version,
  notes: row.notes,
  createdAt: row.created_at
});

function validationError(message) {
  return createAppError(message, { statusCode: 400, code: 'VALIDATION_ERROR' });
}

function createCarbonService({ repository = carbonRepository } = {}) {
  return {
    async listCalculations({ companyId, productId, calculationType, page, limit }) {
      const result = await repository.listCalculations({
        companyId,
        productId,
        calculationType,
        limit,
        offset: (page - 1) * limit
      });
      return {
        data: result.rows.map(formatCalculation),
        meta: { total: result.total, page, limit }
      };
    },

    async createCalculation({ companyId, userId, payload }) {
      const calculationType = payload.calculationType ?? payload.calculation_type;
      const totalCo2e = payload.totalCo2e ?? payload.total_co2e;
      if (!calculationType || totalCo2e === undefined || totalCo2e === null) {
        throw validationError('calculation_type and total_co2e are required');
      }

      const row = await repository.createCalculation({
        companyId,
        userId: userId || null,
        productId: payload.productId ?? payload.product_id ?? null,
        shipmentId: payload.shipmentId ?? payload.shipment_id ?? null,
        calculationType,
        periodStart: payload.periodStart ?? payload.period_start ?? null,
        periodEnd: payload.periodEnd ?? payload.period_end ?? null,
        materialsCo2e: payload.materialsCo2e ?? payload.materials_co2e ?? 0,
        productionCo2e: payload.productionCo2e ?? payload.production_co2e ?? 0,
        transportCo2e: payload.transportCo2e ?? payload.transport_co2e ?? 0,
        packagingCo2e: payload.packagingCo2e ?? payload.packaging_co2e ?? 0,
        totalCo2e,
        methodology: payload.methodology || null,
        emissionFactorVersion:
          payload.emissionFactorVersion ?? payload.emission_factor_version ?? '2024',
        notes: payload.notes || null
      });
      return formatCalculation(row);
    },

    async listElectricityInvoices({ companyId, page, limit }) {
      const result = await repository.listElectricityInvoices({
        companyId,
        limit,
        offset: (page - 1) * limit
      });
      return {
        data: result.rows,
        meta: { total: result.total, page, limit }
      };
    },

    async createElectricityInvoice({ companyId, userId, payload }) {
      const {
        facility_name = 'Main Facility',
        billing_period,
        kwh,
        emission_factor_kg_per_kwh = 0.4290,
        emission_factor_source = 'VN Ministry of Natural Resources 2024',
        status = 'uploaded',
        evidence_document_id
      } = payload;
      if (!billing_period || kwh === undefined || kwh === null) {
        throw validationError('billing_period and kwh are required');
      }

      return repository.createElectricityInvoice({
        companyId,
        userId: userId || null,
        facilityName: facility_name,
        billingPeriod: billing_period,
        kwh,
        emissionFactor: emission_factor_kg_per_kwh,
        emissionFactorSource: emission_factor_source,
        status,
        evidenceDocumentId: evidence_document_id || null
      });
    },

    async updateElectricityInvoice({ id, companyId, changes }) {
      return repository.updateElectricityInvoice({ id, companyId, changes });
    },

    async deleteElectricityInvoice({ id, companyId }) {
      return repository.deleteElectricityInvoice({ id, companyId });
    },

    async listFuelInvoices({ companyId, page, limit }) {
      const result = await repository.listFuelInvoices({
        companyId,
        limit,
        offset: (page - 1) * limit
      });
      return {
        data: result.rows,
        meta: { total: result.total, page, limit }
      };
    },

    async createFuelInvoice({ companyId, userId, payload }) {
      const {
        billing_period,
        fuel_type = 'diesel',
        quantity_liters,
        emission_factor_kg_per_liter,
        scope1_co2e_kg,
        status = 'uploaded',
        evidence_document_id
      } = payload;
      if (!billing_period || quantity_liters === undefined || quantity_liters === null) {
        throw validationError('billing_period and quantity_liters are required');
      }

      const emissionFactor =
        emission_factor_kg_per_liter ?? FUEL_EMISSION_FACTORS[fuel_type] ?? 2.5;
      const scope1Co2e = scope1_co2e_kg ?? (parseFloat(quantity_liters) * emissionFactor);

      return repository.createFuelInvoice({
        companyId,
        userId: userId || null,
        billingPeriod: billing_period,
        fuelType: fuel_type,
        quantityLiters: quantity_liters,
        emissionFactor,
        scope1Co2e,
        status,
        evidenceDocumentId: evidence_document_id || null
      });
    },

    async updateFuelInvoice({ id, companyId, changes }) {
      return repository.updateFuelInvoice({ id, companyId, changes });
    },

    async deleteFuelInvoice({ id, companyId }) {
      return repository.deleteFuelInvoice({ id, companyId });
    }
  };
}

module.exports = {
  FUEL_EMISSION_FACTORS,
  formatCalculation,
  createCarbonService,
  carbonService: createCarbonService()
};
