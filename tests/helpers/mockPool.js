// Shared seam for unit-testing services that `require('../config/database')`.
// `src/config/database.js` exports a live, already-connected `pg.Pool`
// singleton with side effects at require-time, so it cannot be constructed
// with test doubles directly. Instead, tests replace the whole module via
// `jest.mock('.../config/database', () => require('.../tests/helpers/mockPool').createMockPool())`
// before requiring the service under test.
function createMockClient() {
  return {
    query: jest.fn(),
    release: jest.fn()
  };
}

function createMockPool() {
  const client = createMockClient();
  const pool = {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(client),
    on: jest.fn()
  };
  // Exposed so tests can assert on/configure the client returned by connect().
  pool.__mockClient = client;
  return pool;
}

module.exports = { createMockClient, createMockPool };
