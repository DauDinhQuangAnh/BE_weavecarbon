const { bootstrapSchemaCapabilities } = require('../config/schemaBootstrap');
const reportJobQueue = require('../services/reportJobQueue');

let startupPromise = null;

async function bootstrapApplication() {
  if (!startupPromise) {
    startupPromise = (async () => {
      const capabilities = await bootstrapSchemaCapabilities();
      await reportJobQueue.initialize();
      return capabilities;
    })().catch((error) => {
      startupPromise = null;
      throw error;
    });
  }

  return startupPromise;
}

module.exports = {
  bootstrapApplication
};
