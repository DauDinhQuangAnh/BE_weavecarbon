// `uuid@14` ships as an ESM-only package ("type": "module"), which Node can
// require() synchronously (Node 22+ CJS/ESM interop) but Jest's CommonJS
// module system cannot parse. This shim gives Jest a CJS-compatible `v4`
// export backed by Node's built-in crypto.randomUUID, used only in tests via
// jest.config.js `moduleNameMapper` — production code is untouched.
const { randomUUID } = require('crypto');

module.exports = { v4: randomUUID };
