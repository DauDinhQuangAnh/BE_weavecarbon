#!/usr/bin/env node

const fs = require('fs');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const baseUrl = String(argument('base-url') || '').replace(/\/$/, '');
const expected = {
  releaseSha: argument('expected-sha'),
  highestMigration: argument('expected-migration'),
  capabilityVersion: argument('expected-capability')
};
const output = argument('output');

async function read(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => null);
  return { path, status: response.status, ok: response.ok, body };
}

async function main() {
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('--base-url must be HTTPS.');
  if (!/^[a-f0-9]{40}$/i.test(expected.releaseSha || '')) throw new Error('--expected-sha must be a full commit SHA.');
  const checks = await Promise.all(['/health', '/ready', '/version'].map(read));
  const health = checks[0]; const ready = checks[1]; const version = checks[2];
  const gates = {
    health: health.ok && health.body?.data?.status === 'healthy',
    readiness: ready.ok && ready.body?.data?.status === 'ready' && ready.body?.data?.db === 'ok' && ready.body?.data?.queue === 'ok',
    releaseSha: version.ok && version.body?.data?.releaseSha === expected.releaseSha,
    migration: version.ok && version.body?.data?.highestMigration === expected.highestMigration,
    capability: version.ok && version.body?.data?.capabilityVersion === expected.capabilityVersion
  };
  const evidence = {
    schemaId: 'weavecarbon.production-smoke-evidence',
    schemaVersion: '1.0.0',
    checkedAt: new Date().toISOString(),
    baseUrl,
    expected,
    observed: {
      health: health.body?.data || null,
      readiness: ready.body?.data || null,
      version: version.body?.data || null
    },
    gates,
    passed: Object.values(gates).every(Boolean)
  };
  if (output) fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (!evidence.passed) process.exitCode = 1;
}

main().catch((error) => {
  const evidence = {
    schemaId: 'weavecarbon.production-smoke-evidence',
    schemaVersion: '1.0.0',
    checkedAt: new Date().toISOString(),
    baseUrl,
    expected,
    error: error.message,
    passed: false
  };
  if (output) fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(error.message);
  process.exitCode = 1;
});
