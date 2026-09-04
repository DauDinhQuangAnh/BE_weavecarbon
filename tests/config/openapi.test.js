const SwaggerParser = require('@apidevtools/swagger-parser');
const apiRoutes = require('../../src/config/apiRoutes');
const swaggerSpec = require('../../src/config/swagger');
const {
  collectRuntimeOperations,
  countOperations
} = require('../../src/config/openapiContract');

describe('OpenAPI runtime contract', () => {
  test('is a valid OpenAPI 3 document', async () => {
    await expect(SwaggerParser.validate(structuredClone(swaggerSpec))).resolves.toBeDefined();
  });

  test('covers every mounted Express operation exactly once', () => {
    const runtimeOperations = collectRuntimeOperations(apiRoutes);

    for (const operation of runtimeOperations) {
      expect(swaggerSpec.paths[operation.path][operation.method]).toBeDefined();
    }

    expect(countOperations(swaggerSpec)).toBe(runtimeOperations.length + 3);
    expect(swaggerSpec.paths['/health'].get).toBeDefined();
    expect(swaggerSpec.paths['/ready'].get).toBeDefined();
    expect(swaggerSpec.paths['/metrics'].get).toBeDefined();
  });

  test('keeps representative product and member contracts generation-ready', () => {
    const createProduct = swaggerSpec.paths['/products'].post;
    const productSchema = createProduct.requestBody.content['application/json'].schema;
    expect(productSchema.required).toEqual(expect.arrayContaining(['productCode', 'productName']));
    expect(createProduct.responses['2XX'].$ref).toBe('#/components/responses/Product');

    const members = swaggerSpec.paths['/company/members'].get;
    expect(members.responses['2XX'].$ref).toBe('#/components/responses/CompanyMembersList');
    expect(members.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['status', 'role'])
    );
  });

  test('documents auth, errors, multipart and binary transports', () => {
    expect(swaggerSpec.paths['/products'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(swaggerSpec.paths['/auth/signin'].post.security).toEqual([]);
    expect(swaggerSpec.paths['/products'].get.responses['401'].$ref)
      .toBe('#/components/responses/Unauthorized');
    expect(swaggerSpec.paths['/evidence/upload'].post.requestBody.content['multipart/form-data'])
      .toBeDefined();
    expect(swaggerSpec.paths['/reports/{id}/download'].get.responses['2XX'].content['application/octet-stream'])
      .toBeDefined();
  });
});
