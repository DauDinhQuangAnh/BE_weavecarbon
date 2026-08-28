const { checkModuleBoundaries, expectedModules } = require('../../scripts/check-module-boundaries');

describe('modular monolith boundaries', () => {
  test('declares every planned feature and enforces allowed dependency directions', () => {
    expect(expectedModules).toEqual([
      'auth',
      'organizations',
      'products',
      'assessments',
      'carbon',
      'evidence',
      'reports',
      'suppliers-compliance',
      'shared'
    ]);
    expect(checkModuleBoundaries()).toEqual({ moduleCount: 9, referenceModules: 1 });
  });
});
