const { demoAccountService } = require('../../../src/modules/auth');
const router = require('../../../src/routes/auth');

function routeHandler(path) {
  const layer = router.stack.find((candidate) => (
    candidate.route?.path === path && candidate.route.methods.post
  ));
  return layer.route.stack.at(-1).handle;
}

describe('auth demo route compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  test('delegates validated role and scenario to the modular use case', async () => {
    const data = { user: { id: 'demo-user' }, roles: ['b2b'] };
    const createDemoSession = jest.spyOn(demoAccountService, 'createDemoSession')
      .mockResolvedValue(data);
    const req = { body: { role: 'b2b', demo_scenario: 'sample_data' } };
    const res = { json: jest.fn() };

    await routeHandler('/demo')(req, res, jest.fn());

    expect(createDemoSession).toHaveBeenCalledWith('b2b', 'sample_data');
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  test('preserves sample_data as the default scenario', async () => {
    const createDemoSession = jest.spyOn(demoAccountService, 'createDemoSession')
      .mockResolvedValue({ user: { id: 'demo-user' } });

    await routeHandler('/demo')(
      { body: { role: 'b2c' } },
      { json: jest.fn() },
      jest.fn()
    );

    expect(createDemoSession).toHaveBeenCalledWith('b2c', 'sample_data');
  });

  test('passes provisioning failure to the shared error handler', async () => {
    const failure = new Error('provisioning failed');
    jest.spyOn(demoAccountService, 'createDemoSession').mockRejectedValue(failure);
    const next = jest.fn();

    await routeHandler('/demo')(
      { body: { role: 'b2b', demo_scenario: 'sample_data' } },
      { json: jest.fn() },
      next
    );

    expect(next).toHaveBeenCalledWith(failure);
  });
});
