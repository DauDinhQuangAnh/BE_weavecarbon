const pool = require('../config/database');
const b2cDefaultsService = require('./b2cDefaultsService');

const CATEGORY_TO_COLUMN = {
  charity: 'cp.accepts_charity = TRUE',
  recycle: 'cp.accepts_recycle = TRUE'
};

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDistanceKm = (value) => {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Number(parsed.toFixed(3));
};

const mapCollectionPoint = (row) => ({
  id: row.id,
  name: row.name,
  address: row.address,
  city: row.city,
  district: row.district,
  latitude: toNumberOrNull(row.latitude),
  longitude: toNumberOrNull(row.longitude),
  phone: row.phone,
  operating_hours: row.operating_hours,
  accepts_charity: row.accepts_charity === true,
  accepts_recycle: row.accepts_recycle === true,
  distance_km: toDistanceKm(row.distance_km)
});

const appendSearchFilters = ({ conditions, values, category, search, city }) => {
  if (category && CATEGORY_TO_COLUMN[category]) {
    conditions.push(CATEGORY_TO_COLUMN[category]);
  }

  if (typeof search === 'string' && search.trim().length > 0) {
    const normalized = `%${search.trim()}%`;
    values.push(normalized);
    const parameterIndex = values.length;
    conditions.push(`(
      cp.name ILIKE $${parameterIndex}
      OR cp.address ILIKE $${parameterIndex}
      OR cp.city ILIKE $${parameterIndex}
      OR COALESCE(cp.district, '') ILIKE $${parameterIndex}
    )`);
  }

  if (typeof city === 'string' && city.trim().length > 0) {
    values.push(city.trim());
    const parameterIndex = values.length;
    conditions.push(`cp.city ILIKE $${parameterIndex}`);
  }
};

class B2CCollectionPointsService {
  async listCollectionPoints({ category, search, city, limit = 20 }) {
    await b2cDefaultsService.ensureSeedData();

    const conditions = ['cp.is_active = TRUE'];
    const values = [];

    appendSearchFilters({
      conditions,
      values,
      category,
      search,
      city
    });

    values.push(limit);
    const limitIndex = values.length;

    const result = await pool.query({
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
          cp.accepts_recycle
        FROM public.collection_points cp
        WHERE ${conditions.join(' AND ')}
        ORDER BY cp.city ASC, cp.name ASC
        LIMIT $${limitIndex}
      `,
      values
    });

    return {
      items: result.rows.map(mapCollectionPoint)
    };
  }

  async listNearbyCollectionPoints({
    latitude,
    longitude,
    category,
    search,
    city,
    limit = 6
  }) {
    await b2cDefaultsService.ensureSeedData();

    const values = [latitude, longitude];
    const conditions = [
      'cp.is_active = TRUE',
      'cp.latitude IS NOT NULL',
      'cp.longitude IS NOT NULL'
    ];

    appendSearchFilters({
      conditions,
      values,
      category,
      search,
      city
    });

    values.push(limit);
    const limitIndex = values.length;

    const result = await pool.query({
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
        WHERE ${conditions.join(' AND ')}
        ORDER BY distance_km ASC, cp.name ASC
        LIMIT $${limitIndex}
      `,
      values
    });

    return {
      current_location: {
        latitude,
        longitude
      },
      items: result.rows.map(mapCollectionPoint)
    };
  }
}

module.exports = new B2CCollectionPointsService();
