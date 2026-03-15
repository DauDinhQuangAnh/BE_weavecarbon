const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const jsFiles = [];

function collectJsFiles(directoryPath) {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collectJsFiles(fullPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      jsFiles.push(fullPath);
    }
  }
}

collectJsFiles(sourceRoot);

const failures = [];

for (const filePath of jsFiles) {
  const checkResult = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8'
  });

  if (checkResult.status !== 0) {
    failures.push({
      file: path.relative(projectRoot, filePath),
      error: checkResult.stderr.trim()
    });
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log(`Syntax OK (${jsFiles.length} files checked)`);
