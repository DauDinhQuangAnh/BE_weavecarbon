const metrics = require('../../src/operations/metrics');
const TtlCache = require('../../src/utils/ttlCache');

describe('TtlCache policy and tenant-safe invalidation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    metrics.resetForTests();
  });
  afterEach(() => jest.useRealTimers());

  test('records owner/version/TTL and isolates keys by cache namespace', () => {
    const first = new TtlCache({ owner: 'dashboard', version: 'v2', ttlMs: 1000 });
    const second = new TtlCache({ owner: 'reports', version: 'v1', ttlMs: 2000 });
    first.set('tenant-a:overview', 'first');
    second.set('tenant-a:overview', 'second');

    expect(first.policy()).toEqual({ owner: 'dashboard', version: 'v2', ttlMs: 1000 });
    expect(first.get('tenant-a:overview')).toBe('first');
    expect(second.get('tenant-a:overview')).toBe('second');
  });

  test('expires and invalidates only matching tenant keys', () => {
    const cache = new TtlCache({ owner: 'dashboard', version: 'v1', ttlMs: 100 });
    cache.set('tenant-a:one', 1);
    cache.set('tenant-b:one', 2);
    cache.deleteWhere((key) => key.startsWith('tenant-a:'));
    expect(cache.get('tenant-a:one')).toBeUndefined();
    expect(cache.get('tenant-b:one')).toBe(2);
    jest.advanceTimersByTime(101);
    expect(cache.get('tenant-b:one')).toBeUndefined();
  });
});
