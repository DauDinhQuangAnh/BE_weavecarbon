// Transitional infrastructure adapter. Feature modules import this boundary
// instead of reaching into the legacy config tree directly.
module.exports = require('../../config/database');
