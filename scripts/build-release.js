#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_ROOT = path.join(ROOT_DIR, '.release');
const RELEASE_APP_DIR = path.join(RELEASE_ROOT, 'app');

const COPY_ITEMS = [
  'package.json',
  'package-lock.json',
  'src',
  'migrations',
  path.join('scripts', 'migrate.js')
];

function resetReleaseDirectory() {
  fs.rmSync(RELEASE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(RELEASE_APP_DIR, { recursive: true });
}

function copyRecursive(sourcePath, destinationPath) {
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry)
      );
    }
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function buildRelease() {
  resetReleaseDirectory();

  for (const relativePath of COPY_ITEMS) {
    copyRecursive(
      path.join(ROOT_DIR, relativePath),
      path.join(RELEASE_APP_DIR, relativePath)
    );
  }

  fs.writeFileSync(
    path.join(RELEASE_ROOT, 'release-manifest.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        files: COPY_ITEMS
      },
      null,
      2
    )
  );

  console.log(`[release] Staged runtime release at ${RELEASE_APP_DIR}`);
}

buildRelease();
