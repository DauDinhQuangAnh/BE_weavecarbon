describe('organizations compatibility entrypoints', () => {
  test('keeps legacy service and validator imports on the modular implementations', () => {
    const organizations = require('../../../src/modules/organizations');

    expect(require('../../../src/services/companyMembersService'))
      .toBe(organizations.companyMembersService);
    expect(require('../../../src/validators/companyMembersValidators'))
      .toBe(organizations.companyMembersValidators);
  });

  test('keeps the public member route operation surface unchanged', () => {
    const organizations = require('../../../src/modules/organizations');
    const legacyRouter = require('../../../src/routes/companyMembers');
    const operations = legacyRouter.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`
      ));

    expect(legacyRouter).toBe(organizations.companyMembersRouter);
    expect(operations).toEqual([
      'GET /',
      'POST /',
      'POST /:id/resend-invite',
      'PUT /:id',
      'DELETE /:id'
    ]);
  });
});
