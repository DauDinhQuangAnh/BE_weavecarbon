#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['.release', 'coverage', 'dist', 'build'];

for (const target of TARGETS) {
  const absolutePath = path.join(ROOT, target);
  if (!fs.existsSync(absolutePath)) continue;
  fs.rmSync(absolutePath, { recursive: true, force: true });
  console.log(`[clean-local] Removed ${target}`);
}
