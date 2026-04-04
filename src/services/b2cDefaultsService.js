const pool = require('../config/database');
const {
  DEFAULT_B2C_COLLECTION_POINTS,
  DEFAULT_B2C_MATERIAL_REWARDS
} = require('../config/b2cDefaults');

let defaultsReadyPromise = null;

const toCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

class B2CDefaultsService {
  async ensureSeedData(client) {
    if (client) {
      await this._ensureSeedData(client);
      return;
    }

    if (!defaultsReadyPromise) {
      defaultsReadyPromise = (async () => {
        const seededClient = await pool.connect();
        try {
          await this._ensureSeedData(seededClient);
        } finally {
          seededClient.release();
        }
      })().catch((error) => {
        defaultsReadyPromise = null;
        throw error;
      });
    }

    await defaultsReadyPromise;
  }

  async _ensureSeedData(client) {
    await this._seedCollectionPointsIfEmpty(client);
    await this._seedMaterialRewardsIfEmpty(client);
  }

  async _seedCollectionPointsIfEmpty(client) {
    const countResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.collection_points
    `);

    if (toCount(countResult.rows[0]?.count) > 0) {
      return;
    }

    for (const point of DEFAULT_B2C_COLLECTION_POINTS) {
      await client.query(
        `
          INSERT INTO public.collection_points (
            id,
            name,
            address,
            city,
            district,
            latitude,
            longitude,
            phone,
            operating_hours,
            accepts_charity,
            accepts_recycle,
            is_active
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
          )
        `,
        [
          point.id,
          point.name,
          point.address,
          point.city,
          point.district,
          point.latitude,
          point.longitude,
          point.phone,
          point.operating_hours,
          point.accepts_charity,
          point.accepts_recycle,
          point.is_active
        ]
      );
    }
  }

  async _seedMaterialRewardsIfEmpty(client) {
    const countResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.material_rewards
    `);

    if (toCount(countResult.rows[0]?.count) > 0) {
      return;
    }

    for (const material of DEFAULT_B2C_MATERIAL_REWARDS) {
      await client.query(
        `
          INSERT INTO public.material_rewards (
            id,
            material_name,
            material_category,
            points_per_kg,
            co2_saved_per_kg,
            description,
            is_active
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7
          )
        `,
        [
          material.id,
          material.material_name,
          material.material_category,
          material.points_per_kg,
          material.co2_saved_per_kg,
          material.description,
          material.is_active
        ]
      );
    }
  }
}

module.exports = new B2CDefaultsService();
