const SwaggerParser = require('@apidevtools/swagger-parser');

// Route modules load auth configuration at require time. Contract validation never
// signs tokens, so deterministic non-secret placeholders keep this check runnable
// in the lint job without depending on deployment credentials.
process.env.JWT_SECRET ||= 'openapi-contract-check-only';
process.env.JWT_REFRESH_SECRET ||= 'openapi-contract-check-refresh-only';

const apiRoutes = require('../src/config/apiRoutes');
const swaggerSpec = require('../src/config/swagger');
const {
  collectRuntimeOperations,
  countOperations
} = require('../src/config/openapiContract');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRouteParity() {
  const runtimeOperations = collectRuntimeOperations(apiRoutes);
  for (const operation of runtimeOperations) {
    assert(
      swaggerSpec.paths?.[operation.path]?.[operation.method],
      `OpenAPI is missing runtime operation ${operation.operationKey}`
    );
  }

  assert(
    countOperations(swaggerSpec) === runtimeOperations.length + 1,
    `Expected ${runtimeOperations.length + 1} documented operations (runtime + health), found ${countOperations(swaggerSpec)}`
  );

  return runtimeOperations.length;
}

function assertOperationIntegrity() {
  const operationIds = new Set();

  for (const [path, pathItem] of Object.entries(swaggerSpec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      assert(operation.operationId, `${method.toUpperCase()} ${path} has no operationId`);
      assert(!operationIds.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);

      const successResponses = Object.keys(operation.responses || {}).filter((status) => /^2(?:\d\d|XX)$/.test(status));
      assert(successResponses.length > 0, `${method.toUpperCase()} ${path} has no success response`);

      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        const parameter = (operation.parameters || []).find(
          (candidate) => candidate.in === 'path' && candidate.name === match[1]
        );
        assert(parameter?.required === true, `${method.toUpperCase()} ${path} is missing required path parameter ${match[1]}`);
      }
    }
  }

  return operationIds.size;
}

function assertRepresentativeContracts() {
  const productList = swaggerSpec.paths['/products'].get;
  const productQueryNames = new Set(productList.parameters.map((parameter) => parameter.name));
  for (const name of ['search', 'status', 'category', 'page', 'page_size', 'sort_by', 'sort_order', 'include', 'view']) {
    assert(productQueryNames.has(name), `GET /products is missing query parameter ${name}`);
  }

  const productRequest = swaggerSpec.paths['/products'].post.requestBody
    .content['application/json'].schema;
  assert(productRequest.required.includes('productCode'), 'POST /products must require productCode');
  assert(productRequest.required.includes('productName'), 'POST /products must require productName');
  assert(productRequest.example.productCode === 'SKU-001', 'POST /products example is missing');

  const companyMembersResponse = swaggerSpec.components.responses.CompanyMembersList
    .content['application/json'];
  assert(companyMembersResponse.example.data[0].user_id, 'Company member example must use backend snake_case user_id');
  assert(companyMembersResponse.example.data[0].full_name, 'Company member example must use backend snake_case full_name');
  assert(companyMembersResponse.example.meta.total === 1, 'Company member meta example is missing');

  const errorExample = swaggerSpec.components.responses.ValidationError
    .content['application/json'].example;
  assert(errorExample.success === false, 'Error example must use the standard success=false envelope');
  assert(errorExample.error.code === 'VALIDATION_ERROR', 'Validation error code example is inaccurate');
}

async function main() {
  await SwaggerParser.validate(structuredClone(swaggerSpec));
  const runtimeCount = assertRouteParity();
  const operationCount = assertOperationIntegrity();
  assertRepresentativeContracts();

  console.log(
    `OpenAPI OK (${swaggerSpec.openapi}; ${Object.keys(swaggerSpec.paths).length} paths; ` +
    `${operationCount} operations; ${runtimeCount} runtime operations matched)`
  );
}

main().catch((error) => {
  console.error(`OpenAPI check failed: ${error.message}`);
  process.exitCode = 1;
});
