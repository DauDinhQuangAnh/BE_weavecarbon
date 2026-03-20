let capabilities = null;

function setSchemaCapabilities(nextCapabilities) {
  capabilities = Object.freeze({
    ...nextCapabilities,
    loaded_at: new Date().toISOString()
  });
}

function isSchemaCapabilitiesReady() {
  return capabilities !== null;
}

function getSchemaCapabilities() {
  if (!capabilities) {
    throw new Error('Schema capabilities have not been initialized.');
  }

  return capabilities;
}

function hasSchemaCapability(key) {
  return Boolean(getSchemaCapabilities()[key]);
}

function assertSchemaCapability(key, message) {
  if (hasSchemaCapability(key)) {
    return;
  }

  const error = new Error(message || `Missing required schema capability: ${key}`);
  error.code = 'SCHEMA_CAPABILITY_MISSING';
  throw error;
}

module.exports = {
  setSchemaCapabilities,
  isSchemaCapabilitiesReady,
  getSchemaCapabilities,
  hasSchemaCapability,
  assertSchemaCapability
};
