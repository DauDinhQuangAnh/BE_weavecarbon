const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET ||= 'openapi-export-only';
process.env.JWT_REFRESH_SECRET ||= 'openapi-export-refresh-only';

const swaggerSpec = require('../src/config/swagger');

const outputPath = path.join(__dirname, '..', 'openapi', 'openapi.json');
const expected = `${JSON.stringify(swaggerSpec, null, 2)}\n`;
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (current !== expected) {
    console.error('OpenAPI artifact is stale. Run `npm run openapi:export` and commit the result.');
    process.exitCode = 1;
  } else {
    console.log(`OpenAPI artifact is current: ${path.relative(process.cwd(), outputPath)}`);
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}
