const { createJobRepository } = require('../../src/operations/jobRepository');

describe('operational job retention', () => {
  test('prunes only finished jobs older than the configured retention window', async () => {
    const database = {
      query: jest.fn().mockResolvedValue({ rowCount: 4 })
    };
    const repository = createJobRepository({ database });

    await expect(repository.pruneFinished(30)).resolves.toBe(4);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('completed', 'dead')"),
      [30]
    );
    expect(database.query.mock.calls[0][0]).toContain('COALESCE(completed_at, updated_at)');
  });
});
