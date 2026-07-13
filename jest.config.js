module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  // Excludes the packaged release output from Jest's module/haste scanning —
  // it duplicates src/ under a package.json with the same "name", which
  // otherwise trips a "Haste module naming collision" error.
  modulePathIgnorePatterns: ['<rootDir>/.release/'],
  // uuid@14 is ESM-only and unparseable by Jest's CJS transform; swap in a
  // CJS-compatible shim for tests only (see tests/mocks/uuidShim.js).
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/mocks/uuidShim.js'
  }
};
