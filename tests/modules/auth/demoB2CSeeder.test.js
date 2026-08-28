const {
  getDemoB2CLevel,
  buildDemoB2CItem,
  createDemoB2CSeeder
} = require('../../../src/modules/auth/demoB2CSeeder');

describe('auth demo B2C seeder', () => {
  test('preserves reward level thresholds and item rounding', () => {
    expect(getDemoB2CLevel(399)).toBe('Beginner');
    expect(getDemoB2CLevel(400)).toBe('Explorer');
    expect(getDemoB2CLevel(1000)).toBe('Advocate');
    expect(getDemoB2CLevel(2000)).toBe('Champion');
    expect(buildDemoB2CItem(
      { id: 'material-1', points_per_kg: '7.5', co2_saved_per_kg: '1.23456' },
      'Shirts',
      'shirt',
      'good',
      2
    )).toEqual({
      item_name: 'Shirts',
      item_type: 'shirt',
      condition: 'good',
      material_id: 'material-1',
      weight_kg: 2,
      points_earned: 15,
      co2_saved: 2.4691
    });
  });

  test('uses fallback rewards when material defaults are insufficient', async () => {
    const repository = {
      findActiveRewardMaterials: jest.fn().mockResolvedValue([{ id: 'only-one' }]),
      insertFallbackRewards: jest.fn().mockResolvedValue()
    };
    const defaults = { ensureSeedData: jest.fn().mockResolvedValue() };
    const seeder = createDemoB2CSeeder({ repository, defaults });
    const client = { id: 'transaction' };

    await seeder.seed(client, 'user-1');

    expect(defaults.ensureSeedData).toHaveBeenCalledWith(client);
    expect(repository.insertFallbackRewards).toHaveBeenCalledWith(client, 'user-1');
  });

  test('creates two donations and aggregates their rewards exactly', async () => {
    const materials = [
      { id: 'cotton', points_per_kg: 10, co2_saved_per_kg: 2 },
      { id: 'polyester', points_per_kg: 5, co2_saved_per_kg: 1 },
      { id: 'linen', points_per_kg: 8, co2_saved_per_kg: 1.5 }
    ];
    const repository = {
      findActiveRewardMaterials: jest.fn().mockResolvedValue(materials),
      findCollectionPoint: jest.fn().mockResolvedValue({ id: 'point-1' }),
      insertDonation: jest.fn()
        .mockResolvedValueOnce({ id: 'donation-1' })
        .mockResolvedValueOnce({ id: 'donation-2' }),
      insertDonationItem: jest.fn().mockResolvedValue(),
      insertRewardTransaction: jest.fn().mockResolvedValue(),
      upsertUserRewards: jest.fn().mockResolvedValue()
    };
    const defaults = { ensureSeedData: jest.fn().mockResolvedValue() };
    const seeder = createDemoB2CSeeder({
      repository,
      defaults,
      now: () => Date.parse('2026-08-28T00:00:00.000Z')
    });

    await seeder.seed({ id: 'transaction' }, 'user-1');

    expect(repository.insertDonation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        category: 'charity',
        basePoints: 65,
        bonusPoints: 33,
        totalPoints: 98,
        weightKg: 8,
        co2Saved: 13,
        collectionPointId: 'point-1'
      })
    );
    expect(repository.insertDonation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        category: 'recycle',
        basePoints: 36,
        bonusPoints: 0,
        totalPoints: 36,
        weightKg: 6,
        co2Saved: 7
      })
    );
    expect(repository.insertDonationItem).toHaveBeenCalledTimes(4);
    expect(repository.insertRewardTransaction).toHaveBeenCalledTimes(2);
    expect(repository.upsertUserRewards).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: 'user-1',
        totalPoints: 134,
        totalDonations: 2,
        totalItems: 4,
        totalWeightKg: 14,
        totalCo2Saved: 20,
        currentLevel: 'Beginner'
      }
    );
  });
});
