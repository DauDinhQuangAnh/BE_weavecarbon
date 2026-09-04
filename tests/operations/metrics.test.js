const metrics = require('../../src/operations/metrics');

describe('Prometheus metrics', () => {
  beforeEach(() => metrics.resetForTests());

  test('renders counters with escaped labels and gauges', () => {
    metrics.increment('weavecarbon_cache_requests_total', { cache: 'dash"board', result: 'hit' });
    metrics.setGauge('weavecarbon_jobs_active', {}, 2);
    const output = metrics.render();
    expect(output).toContain('weavecarbon_cache_requests_total{cache="dash\\"board",result="hit"} 1');
    expect(output).toContain('weavecarbon_jobs_active 2');
  });
});
