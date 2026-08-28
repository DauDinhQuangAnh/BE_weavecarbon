const fs = require('fs');
const path = require('path');

const srcRoot = path.join(__dirname, '..', 'src');
const modulesRoot = path.join(srcRoot, 'modules');
const expectedModules = [
  'auth',
  'organizations',
  'products',
  'assessments',
  'carbon',
  'evidence',
  'reports',
  'suppliers-compliance',
  'shared'
];

function walkJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function moduleNameFor(filePath) {
  const relative = path.relative(modulesRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0];
}

function checkModuleBoundaries() {
  const errors = [];
  const manifests = new Map();

  for (const moduleName of expectedModules) {
    const manifestPath = path.join(modulesRoot, moduleName, 'module.json');
    if (!fs.existsSync(manifestPath)) {
      errors.push(`Missing module manifest: ${moduleName}/module.json`);
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifests.set(moduleName, manifest);
    if (manifest.name !== moduleName) {
      errors.push(`${moduleName}/module.json declares name ${manifest.name}`);
    }
    if (!Array.isArray(manifest.allowedDependencies)) {
      errors.push(`${moduleName}/module.json must declare allowedDependencies`);
    }
  }

  for (const [moduleName, manifest] of manifests) {
    for (const dependency of manifest.allowedDependencies || []) {
      if (!expectedModules.includes(dependency)) {
        errors.push(`${moduleName} allows unknown module dependency ${dependency}`);
      }
    }
  }

  for (const sourcePath of walkJavaScript(modulesRoot)) {
    const sourceModule = moduleNameFor(sourcePath);
    if (!sourceModule || sourceModule === 'shared') continue;

    const manifest = manifests.get(sourceModule);
    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const targetPath = path.resolve(path.dirname(sourcePath), match[1]);
      const targetModule = moduleNameFor(targetPath);
      const location = path.relative(path.join(__dirname, '..'), sourcePath);

      if (!targetModule) {
        errors.push(`${location} escapes src/modules via ${match[1]}`);
      } else if (
        targetModule !== sourceModule &&
        !(manifest?.allowedDependencies || []).includes(targetModule)
      ) {
        errors.push(`${location} imports disallowed module ${targetModule}`);
      }
    }
  }

  for (const sourcePath of walkJavaScript(srcRoot)) {
    if (moduleNameFor(sourcePath)) continue;

    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const targetPath = path.resolve(path.dirname(sourcePath), match[1]);
      const targetModule = moduleNameFor(targetPath);
      if (!targetModule) continue;

      const publicRoot = path.join(modulesRoot, targetModule);
      if (targetPath !== publicRoot && targetPath !== path.join(publicRoot, 'index.js')) {
        const location = path.relative(path.join(__dirname, '..'), sourcePath);
        errors.push(`${location} bypasses the ${targetModule} public module surface`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Module boundary check failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    moduleCount: manifests.size,
    referenceModules: [...manifests.values()].filter(({ status }) => status === 'reference').length
  };
}

if (require.main === module) {
  try {
    const result = checkModuleBoundaries();
    console.log(
      `Module boundaries OK (${result.moduleCount} modules; ` +
      `${result.referenceModules} reference implementation)`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkModuleBoundaries, expectedModules };
