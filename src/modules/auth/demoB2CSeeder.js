const { demoRepository } = require('./demoRepository');
const b2cDefaults = require('../shared/b2cDefaults');

function getDemoB2CLevel(totalPoints) {
  if (totalPoints >= 2000) return 'Champion';
  if (totalPoints >= 1000) return 'Advocate';
  if (totalPoints >= 400) return 'Explorer';
  return 'Beginner';
}

function buildDemoB2CItem(material, itemName, itemType, condition, weightKg) {
  const pointsEarned = Math.round(Number(material.points_per_kg || 0) * weightKg);
  const co2Saved = Number(
    (Number(material.co2_saved_per_kg || 0) * weightKg).toFixed(4)
  );
  return {
    item_name: itemName,
    item_type: itemType,
    condition,
    material_id: material.id,
    weight_kg: weightKg,
    points_earned: pointsEarned,
    co2_saved: co2Saved
  };
}

function createDemoB2CSeeder({
  repository = demoRepository,
  defaults = b2cDefaults,
  now = () => Date.now()
} = {}) {
  return {
    async seed(client, userId) {
      await defaults.ensureSeedData(client);
      const materials = await repository.findActiveRewardMaterials(client);
      if (materials.length < 2) {
        await repository.insertFallbackRewards(client, userId);
        return;
      }

      const collectionPoint = await repository.findCollectionPoint(client);
      const [cotton, polyester, linen = materials[1]] = materials;
      const donationSpecs = [
        {
          category: 'charity',
          status: 'received',
          daysAgo: 3,
          description: 'Demo donation: cotton shirts and recycled fabric',
          items: [
            buildDemoB2CItem(cotton, 'Cotton shirts', 'shirt', 'good', 5),
            buildDemoB2CItem(polyester, 'Reusable tote bags', 'bag', 'good', 3)
          ]
        },
        {
          category: 'recycle',
          status: 'processed',
          daysAgo: 1,
          description: 'Demo recycling: mixed textile batch',
          items: [
            buildDemoB2CItem(polyester, 'Polyester jackets', 'jacket', 'worn', 4),
            buildDemoB2CItem(linen, 'Linen scraps', 'fabric', 'worn', 2)
          ]
        }
      ];

      let totalPoints = 0;
      let totalItems = 0;
      let totalWeightKg = 0;
      let totalCo2Saved = 0;

      for (const donation of donationSpecs) {
        const basePoints = donation.items.reduce(
          (sum, item) => sum + item.points_earned,
          0
        );
        const bonusPoints = donation.category === 'charity'
          ? Math.round(basePoints * 0.5)
          : 0;
        const donationPoints = basePoints + bonusPoints;
        const donationWeight = Number(
          donation.items.reduce((sum, item) => sum + item.weight_kg, 0).toFixed(4)
        );
        const donationCo2Saved = Number(
          donation.items.reduce((sum, item) => sum + item.co2_saved, 0).toFixed(4)
        );
        const createdAt = new Date(now() - donation.daysAgo * 24 * 60 * 60 * 1000);
        const created = await repository.insertDonation(client, {
          userId,
          category: donation.category,
          status: donation.status,
          description: donation.description,
          materialId: donation.items.length === 1 ? donation.items[0].material_id : null,
          weightKg: donationWeight,
          collectionPointId: collectionPoint?.id || null,
          basePoints,
          bonusPoints,
          totalPoints: donationPoints,
          co2Saved: donationCo2Saved,
          createdAt,
          completedAt: donation.status === 'processed' ? createdAt : null
        });

        for (const item of donation.items) {
          await repository.insertDonationItem(client, created.id, item, createdAt);
        }
        await repository.insertRewardTransaction(client, {
          userId,
          donationId: created.id,
          points: donationPoints,
          description: donation.category === 'charity'
            ? 'Demo charity donation reward'
            : 'Demo textile recycling reward',
          createdAt
        });

        totalPoints += donationPoints;
        totalItems += donation.items.length;
        totalWeightKg += donationWeight;
        totalCo2Saved += donationCo2Saved;
      }

      await repository.upsertUserRewards(client, {
        userId,
        totalPoints,
        totalDonations: donationSpecs.length,
        totalItems,
        totalWeightKg: Number(totalWeightKg.toFixed(4)),
        totalCo2Saved: Number(totalCo2Saved.toFixed(4)),
        currentLevel: getDemoB2CLevel(totalPoints)
      });
    }
  };
}

module.exports = {
  getDemoB2CLevel,
  buildDemoB2CItem,
  createDemoB2CSeeder,
  demoB2CSeeder: createDemoB2CSeeder()
};
