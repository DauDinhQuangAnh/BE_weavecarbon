const pool = require('../shared/database');

class SupplierRequestsRepository {
  async findMany({ companyId, limit, offset }) {
    const { rows } = await pool.query(
      `SELECT id, supplier_name, supplier_email, material_supplied,
              required_data, deadline, status, sent_at, created_at, updated_at
       FROM supplier_requests
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );
    return rows;
  }

  async create({ companyId, supplierName, supplierEmail, materialSupplied, requiredData, deadline, status }) {
    const { rows } = await pool.query(
      `INSERT INTO supplier_requests
         (company_id, supplier_name, supplier_email, material_supplied, required_data, deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, supplier_name, supplier_email, material_supplied,
                 required_data, deadline, status, sent_at, created_at, updated_at`,
      [companyId, supplierName, supplierEmail, materialSupplied, requiredData, deadline, status]
    );
    return rows[0];
  }

  async findUpdateContext({ id, companyId }) {
    const { rows } = await pool.query(
      `SELECT status, supplier_name, supplier_email
       FROM supplier_requests
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return rows[0] || null;
  }

  async update({ id, companyId, status, sentAt, deadline, requiredData }) {
    const { rows } = await pool.query(
      `UPDATE supplier_requests
       SET status        = COALESCE($3, status),
           sent_at       = COALESCE($4::TIMESTAMPTZ, sent_at),
           deadline      = COALESCE($5::DATE, deadline),
           required_data = COALESCE($6, required_data),
           updated_at    = now()
       WHERE id = $1 AND company_id = $2
       RETURNING id, supplier_name, supplier_email, material_supplied,
                 required_data, deadline, status, sent_at, created_at, updated_at`,
      [id, companyId, status, sentAt, deadline, requiredData]
    );
    return rows[0] || null;
  }

  async remove({ id, companyId }) {
    const { rows } = await pool.query(
      `DELETE FROM supplier_requests WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId]
    );
    return rows[0]?.id || null;
  }
}

module.exports = new SupplierRequestsRepository();
