const counters = new Map();
const gauges = new Map();

function normalizeLabelValue(value) {
  return String(value ?? 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function keyFor(name, labels = {}) {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  const suffix = entries.length
    ? `{${entries.map(([key, value]) => `${key}="${normalizeLabelValue(value)}"`).join(',')}}`
    : '';
  return `${name}${suffix}`;
}

function increment(name, labels = {}, value = 1) {
  const key = keyFor(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

function setGauge(name, labels = {}, value = 0) {
  gauges.set(keyFor(name, labels), Number(value) || 0);
}

function render() {
  const lines = [
    '# HELP weavecarbon_process_uptime_seconds Process uptime in seconds.',
    '# TYPE weavecarbon_process_uptime_seconds gauge',
    `weavecarbon_process_uptime_seconds ${process.uptime().toFixed(3)}`
  ];

  for (const [key, value] of [...counters.entries()].sort()) {
    lines.push(`${key} ${value}`);
  }
  for (const [key, value] of [...gauges.entries()].sort()) {
    lines.push(`${key} ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

function resetForTests() {
  counters.clear();
  gauges.clear();
}

module.exports = { increment, render, resetForTests, setGauge };
