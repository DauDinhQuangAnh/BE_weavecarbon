const fs = require('fs');
const path = require('path');

describe('backend runtime container policy', () => {
  const dockerfile = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'Dockerfile'),
    'utf8'
  );

  test('runs as non-root without the build-time npm package manager', () => {
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm');
    expect(dockerfile).toContain('rm -f /usr/local/bin/npm /usr/local/bin/npx');
  });
});
