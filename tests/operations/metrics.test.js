const metrics = require('../../src/operations/metrics');

describe('Prometheus metrics', () => {
  beforeEach(() => metrics.resetForTests());

  test('renders counters with escaped labels and gauges', () => {
    metrics.increment('weavecarbon_cache_requests_total', { cache: 'dash"board', result: 'hit' });
    metrics.increment('weavecarbon_db_query_duration_ms_sum', { operation: 'SELECT' }, 12.5);
    metrics.setGauge('weavecarbon_jobs_active', {}, 2);
    const output = metrics.render();
    expect(output).toContain('weavecarbon_cache_requests_total{cache="dash\\"board",result="hit"} 1');
    expect(output).toContain('weavecarbon_jobs_active 2');
    expect(output).toContain('weavecarbon_db_query_duration_ms_sum{operation="SELECT"} 12.5');
  });
});
