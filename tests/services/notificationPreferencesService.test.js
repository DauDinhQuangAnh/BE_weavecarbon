jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const {
  createNotificationPreferencesService,
  normalizePreferences
} = require('../../src/services/notificationPreferencesService');

describe('notificationPreferencesService', () => {
  test('normalizePreferences keeps boolean preferences keyed by notification id', () => {
    expect(normalizePreferences({ report_ready: false, shipment_status: true })).toEqual({
      report_ready: false,
      shipment_status: true
    });
  });

  test.each([
    [null],
    [[]],
    ['report_ready'],
    [{ report_ready: 'no' }],
    [{ 'Report Ready': true }]
  ])('normalizePreferences rejects %p', (input) => {
    expect(() => normalizePreferences(input)).toThrow(expect.objectContaining({ code: 'INVALID_NOTIFICATION_PREFERENCES' }));
  });

  test('getPreferences returns an empty object when nothing was saved', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const service = createNotificationPreferencesService({ database });
    await expect(service.getPreferences('user-1')).resolves.toEqual({ preferences: {}, updatedAt: null });
    expect(database.query.mock.calls[0][1]).toEqual(['user-1']);
  });

  test('updatePreferences upserts the validated preferences for the user', async () => {
    const savedAt = new Date('2026-11-23T08:00:00Z');
    const database = {
      query: jest.fn().mockResolvedValue({ rows: [{ preferences: { report_ready: false }, updated_at: savedAt }] })
    };
    const service = createNotificationPreferencesService({ database });
    await expect(service.updatePreferences('user-1', { report_ready: false })).resolves.toEqual({
      preferences: { report_ready: false },
      updatedAt: savedAt
    });
    expect(database.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
    expect(database.query.mock.calls[0][1]).toEqual(['user-1', JSON.stringify({ report_ready: false })]);
  });
});
