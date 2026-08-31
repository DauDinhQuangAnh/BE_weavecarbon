const pool = require('../shared/database');

function createCarbonRepository({ database = pool } = {}) {
  return {
    async listCalculations({ companyId, productId, calculationType, limit, offset }) {
      const conditions = ['company_id = $1'];
      const params = [companyId];

      if (productId) {
        params.push(productId);
        conditions.push(`product_id = $${params.length}`);
      }

      if (calculationType) {
        params.push(calculationType);
        conditions.push(`calculation_type = $${params.length}`);
      }

      const where = conditions.join(' AND ');
      const { rows } = await database.query(
        `SELECT id, product_id, shipment_id, calculation_type,
                period_start, period_end,
                materials_co2e, production_co2e, transport_co2e,
                packaging_co2e, total_co2e,
                methodology, emission_factor_version, notes, created_at
         FROM carbon_calculations
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const { rows: countRows } = await database.query(
        `SELECT COUNT(*) FROM carbon_calculations WHERE ${where}`,
        params
      );

      return { rows, total: parseInt(countRows[0].count, 10) };
    },

    async createCalculation(values) {
      const { rows } = await database.query(
        `INSERT INTO carbon_calculations
           (company_id, product_id, shipment_id, calculation_type,
            period_start, period_end,
            materials_co2e, production_co2e, transport_co2e, packaging_co2e,
            total_co2e, methodology, emission_factor_version, notes, calculated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, product_id, shipment_id, calculation_type, total_co2e,
                   materials_co2e, production_co2e, transport_co2e, packaging_co2e,
                   period_start, period_end, methodology, emission_factor_version, notes, created_at`,
        [
          values.companyId,
          values.productId,
          values.shipmentId,
          values.calculationType,
          values.periodStart,
          values.periodEnd,
          values.materialsCo2e,
          values.productionCo2e,
          values.transportCo2e,
          values.packagingCo2e,
          values.totalCo2e,
          values.methodology,
          values.emissionFactorVersion,
          values.notes,
          values.userId
        ]
      );
      return rows[0];
    },

    async listElectricityInvoices({ companyId, limit, offset }) {
      const { rows } = await database.query(
        `SELECT id, facility_name, billing_period, kwh,
                emission_factor_kg_per_kwh, emission_factor_source,
                scope2_co2e_kg, status, evidence_document_id, created_at, updated_at
         FROM electricity_invoices
         WHERE company_id = $1
         ORDER BY billing_period DESC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      );
      const { rows: countRows } = await database.query(
        'SELECT COUNT(*) FROM electricity_invoices WHERE company_id = $1',
        [companyId]
      );
      return { rows, total: parseInt(countRows[0].count, 10) };
    },

    async createElectricityInvoice(values) {
      const { rows } = await database.query(
        `INSERT INTO electricity_invoices
           (company_id, facility_name, billing_period, kwh,
            emission_factor_kg_per_kwh, emission_factor_source,
            status, evidence_document_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, facility_name, billing_period, kwh,
                   emission_factor_kg_per_kwh, emission_factor_source,
                   scope2_co2e_kg, status, created_at`,
        [
          values.companyId,
          values.facilityName,
          values.billingPeriod,
          values.kwh,
          values.emissionFactor,
          values.emissionFactorSource,
          values.status,
          values.evidenceDocumentId,
          values.userId
        ]
      );
      return rows[0];
    },

    async updateElectricityInvoice({ id, companyId, changes }) {
      const { rows } = await database.query(
        `UPDATE electricity_invoices SET
           facility_name = COALESCE($3, facility_name),
           billing_period = COALESCE($4, billing_period),
           kwh = COALESCE($5, kwh),
           emission_factor_kg_per_kwh = COALESCE($6, emission_factor_kg_per_kwh),
           emission_factor_source = COALESCE($7, emission_factor_source),
           status = COALESCE($8, status),
           updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING id, facility_name, billing_period, kwh,
                   emission_factor_kg_per_kwh, emission_factor_source,
                   scope2_co2e_kg, status, updated_at`,
        [
          id,
          companyId,
          changes.facility_name,
          changes.billing_period,
          changes.kwh,
          changes.emission_factor_kg_per_kwh,
          changes.emission_factor_source,
          changes.status
        ]
      );
      return rows[0] || null;
    },

    async deleteElectricityInvoice({ id, companyId }) {
      const { rowCount } = await database.query(
        'DELETE FROM electricity_invoices WHERE id = $1 AND company_id = $2',
        [id, companyId]
      );
      return rowCount > 0;
    },

    async listFuelInvoices({ companyId, limit, offset }) {
      const { rows } = await database.query(
        `SELECT id, billing_period, fuel_type, quantity_liters,
                emission_factor_kg_per_liter, scope1_co2e_kg,
                status, evidence_document_id, created_at, updated_at
         FROM fuel_invoices
         WHERE company_id = $1
         ORDER BY billing_period DESC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      );
      const { rows: countRows } = await database.query(
        'SELECT COUNT(*) FROM fuel_invoices WHERE company_id = $1',
        [companyId]
      );
      return { rows, total: parseInt(countRows[0].count, 10) };
    },

    async createFuelInvoice(values) {
      const { rows } = await database.query(
        `INSERT INTO fuel_invoices
           (company_id, billing_period, fuel_type, quantity_liters,
            emission_factor_kg_per_liter, scope1_co2e_kg,
            status, evidence_document_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, billing_period, fuel_type, quantity_liters,
                   emission_factor_kg_per_liter, scope1_co2e_kg, status, created_at`,
        [
          values.companyId,
          values.billingPeriod,
          values.fuelType,
          values.quantityLiters,
          values.emissionFactor,
          values.scope1Co2e,
          values.status,
          values.evidenceDocumentId,
          values.userId
        ]
      );
      return rows[0];
    },

    async updateFuelInvoice({ id, companyId, changes }) {
      const { rows } = await database.query(
        `UPDATE fuel_invoices SET
           billing_period = COALESCE($3, billing_period),
           fuel_type = COALESCE($4, fuel_type),
           quantity_liters = COALESCE($5, quantity_liters),
           emission_factor_kg_per_liter = COALESCE($6, emission_factor_kg_per_liter),
           scope1_co2e_kg = COALESCE($7, scope1_co2e_kg),
           status = COALESCE($8, status),
           updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING id, billing_period, fuel_type, quantity_liters,
                   emission_factor_kg_per_liter, scope1_co2e_kg, status, updated_at`,
        [
          id,
          companyId,
          changes.billing_period,
          changes.fuel_type,
          changes.quantity_liters,
          changes.emission_factor_kg_per_liter,
          changes.scope1_co2e_kg,
          changes.status
        ]
      );
      return rows[0] || null;
    },

    async deleteFuelInvoice({ id, companyId }) {
      const { rowCount } = await database.query(
        'DELETE FROM fuel_invoices WHERE id = $1 AND company_id = $2',
        [id, companyId]
      );
      return rowCount > 0;
    }
  };
}

module.exports = {
  createCarbonRepository,
  carbonRepository: createCarbonRepository()
};
