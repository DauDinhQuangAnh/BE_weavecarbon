const pool = require('../config/database');

class B2CCollectionPointsService {
  async listNearbyCollectionPoints({ latitude, longitude, limit = 6 }) {
    const query = {
      text: `
        SELECT
          cp.id,
          cp.name,
          cp.address,
          cp.city,
          cp.district,
          cp.latitude::double precision AS latitude,
          cp.longitude::double precision AS longitude,
          cp.phone,
          cp.operating_hours,
          cp.accepts_charity,
          cp.accepts_recycle,
          (
            6371 * 2 * ASIN(
              SQRT(
                POWER(SIN(RADIANS((cp.latitude::double precision - $1) / 2)), 2) +
                COS(RADIANS($1)) *
                COS(RADIANS(cp.latitude::double precision)) *
                POWER(SIN(RADIANS((cp.longitude::double precision - $2) / 2)), 2)
              )
            )
          ) AS distance_km
        FROM public.collection_points cp
        WHERE cp.is_active = TRUE
          AND cp.latitude IS NOT NULL
          AND cp.longitude IS NOT NULL
        ORDER BY distance_km ASC, cp.name ASC
        LIMIT $3
      `,
      values: [latitude, longitude, limit]
    };

    const result = await pool.query(query);

    return {
      current_location: {
        latitude,
        longitude
      },
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        city: row.city,
        district: row.district,
        latitude: row.latitude,
        longitude: row.longitude,
        phone: row.phone,
        operating_hours: row.operating_hours,
        accepts_charity: row.accepts_charity,
        accepts_recycle: row.accepts_recycle,
        distance_km:
          Number.isFinite(Number(row.distance_km)) ?
            Number(Number(row.distance_km).toFixed(3)) :
            null
      }))
    };
  }
}

module.exports = new B2CCollectionPointsService();
