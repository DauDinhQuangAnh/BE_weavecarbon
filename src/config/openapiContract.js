const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const PUBLIC_OPERATIONS = new Set([
  'GET /health',
  'GET /auth/accept-company-invite',
  'GET /auth/google',
  'GET /auth/google/callback',
  'GET /auth/session',
  'GET /auth/verify-email',
  'POST /auth/demo',
  'POST /auth/refresh',
  'POST /auth/signin',
  'POST /auth/signout',
  'POST /auth/signup',
  'POST /auth/verify-email',
  'POST /auth/verify-email/resend',
  'POST /contact/lead',
  'GET /passport/{productId}',
  'GET /subscription/vnpay/ipn',
  'GET /subscription/vnpay/mock-checkout',
  'GET /subscription/vnpay/mock-complete',
  'GET /subscription/vnpay/return'
]);

const MULTIPART_OPERATIONS = new Set([
  'POST /ai-config/rag/ingest',
  'POST /b2c/analyze-donation-image',
  'POST /evidence/upload',
  'POST /evidence/{id}/rag-ingest',
  'POST /export/markets/{market_code}/documents/{document_id}/upload',
  'POST /export/markets/{market_code}/documents/import',
  'POST /products/bulk-import/file'
]);

const BINARY_OPERATIONS = new Map([
  ['GET /b2c/donations/{id}/image', 'image/*'],
  ['GET /export/documents/bill-of-lading', 'application/octet-stream'],
  ['GET /export/documents/commercial-invoice', 'application/octet-stream'],
  ['GET /export/documents/packing-list', 'application/octet-stream'],
  ['GET /export/markets/{market_code}/documents/{document_id}/download', 'application/octet-stream'],
  ['GET /products/bulk-template', 'text/csv'],
  ['GET /products/bulk-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['GET /reports/{id}/download', 'application/octet-stream']
]);

const REDIRECT_OR_HTML_OPERATIONS = new Set([
  'GET /auth/accept-company-invite',
  'GET /auth/google',
  'GET /auth/google/callback',
  'GET /auth/verify-email',
  'GET /subscription/vnpay/ipn',
  'GET /subscription/vnpay/mock-checkout',
  'GET /subscription/vnpay/mock-complete',
  'GET /subscription/vnpay/return'
]);

const QUERY_PARAMETER_OVERRIDES = {
  'GET /audit-trail': ['limit', 'page', 'changed_field', 'data_group'],
  'GET /b2c/collection-points': ['search', 'province', 'district', 'limit'],
  'GET /b2c/collection-points/nearby': ['latitude', 'longitude', 'radius_km', 'limit'],
  'GET /b2c/coupons': ['status', 'limit'],
  'GET /b2c/donations': ['limit'],
  'GET /b2c/reward-transactions': ['limit'],
  'GET /carbon-calculations': ['limit'],
  'GET /chat/conversations': ['page', 'page_size'],
  'GET /company/members': ['status', 'role'],
  'GET /evidence': ['productId', 'page', 'page_size', 'status'],
  'GET /export/markets': ['product_id'],
  'GET /logistics/shipments': ['search', 'status', 'page', 'page_size', 'sort_by', 'sort_order'],
  'GET /product-batches': ['search', 'status', 'page', 'page_size', 'sort_by', 'sort_order'],
  'GET /products': ['search', 'status', 'category', 'page', 'page_size', 'sort_by', 'sort_order', 'include', 'view'],
  'GET /products/bulk-template': ['format'],
  'GET /reports': ['search', 'type', 'status', 'date_from', 'date_to', 'page', 'page_size'],
  'GET /subscription/payment-status': ['txn_ref']
};

const INTEGER_QUERY_PARAMETERS = new Set(['limit', 'page', 'page_size']);
const NUMBER_QUERY_PARAMETERS = new Set(['latitude', 'longitude', 'radius_km']);

const PRODUCT_MUTATION_SCHEMA = {
  type: 'object',
  required: ['productCode', 'productName'],
  properties: {
    productCode: { type: 'string', minLength: 1, maxLength: 100 },
    productName: { type: 'string', minLength: 1, maxLength: 200 },
    productType: { type: 'string', maxLength: 100 },
    weightPerUnit: { type: 'number', minimum: 0 },
    quantity: { type: 'integer', minimum: 0 },
    materials: { type: 'array', items: { type: 'object', additionalProperties: true } },
    accessories: { type: 'array', items: { type: 'object', additionalProperties: true } },
    productionProcesses: { type: 'array', items: { type: 'object', additionalProperties: true } },
    energySources: { type: 'array', items: { type: 'object', additionalProperties: true } },
    carbonResults: { type: 'object', additionalProperties: true },
    save_mode: { type: 'string', enum: ['draft', 'publish'] }
  },
  additionalProperties: true,
  example: {
    productCode: 'SKU-001',
    productName: 'Organic cotton T-shirt',
    productType: 'tshirt',
    quantity: 1000,
    weightPerUnit: 250,
    save_mode: 'draft'
  }
};

const REQUEST_BODY_OVERRIDES = {
  'POST /products': PRODUCT_MUTATION_SCHEMA,
  'PUT /products/{id}': PRODUCT_MUTATION_SCHEMA,
  'PATCH /products/{id}/status': {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['draft', 'published', 'active', 'archived'] }
    },
    additionalProperties: false,
    example: { status: 'published' }
  },
  'POST /company/members': {
    type: 'object',
    required: ['email', 'full_name', 'role'],
    properties: {
      email: { type: 'string', format: 'email' },
      full_name: { type: 'string', minLength: 2, maxLength: 100 },
      role: { type: 'string', enum: ['member', 'viewer'] },
      send_notification_email: { type: 'boolean', default: true },
      frontend_origin: { type: 'string', format: 'uri' }
    },
    additionalProperties: false,
    example: {
      email: 'member@example.com',
      full_name: 'Example Member',
      role: 'member',
      send_notification_email: true
    }
  },
  'PUT /company/members/{id}': {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['member', 'viewer'] },
      status: { type: 'string', enum: ['active', 'disabled'] }
    },
    minProperties: 1,
    additionalProperties: false,
    example: { role: 'viewer' }
  }
};

function normalizePath(basePath, routePath) {
  const mountPath = basePath.replace(/^\/api/, '');
  const suffix = routePath === '/' ? '' : routePath;
  return `${mountPath}${suffix}`
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectQueryNames(routeLayer, operationKey) {
  const names = new Set(QUERY_PARAMETER_OVERRIDES[operationKey] || []);
  const source = (routeLayer.stack || [])
    .map((layer) => String(layer.handle || ''))
    .join('\n');

  for (const match of source.matchAll(/req\.query\.([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/req\.query\[['"]([^'"]+)['"]\]/g)) {
    names.add(match[1]);
  }

  return [...names].sort();
}

function collectRuntimeOperations(apiRoutes) {
  const operations = [];

  for (const { basePath, tag, router } of apiRoutes) {
    for (const layer of router.stack || []) {
      if (!layer.route) {
        continue;
      }

      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        for (const method of Object.keys(layer.route.methods || {})) {
          if (!HTTP_METHODS.has(method) || !layer.route.methods[method]) {
            continue;
          }

          const path = normalizePath(basePath, routePath);
          const operationKey = `${method.toUpperCase()} ${path}`;
          operations.push({
            method,
            path,
            tag,
            operationKey,
            queryNames: collectQueryNames(layer.route, operationKey)
          });
        }
      }
    }
  }

  return operations.sort((left, right) => left.operationKey.localeCompare(right.operationKey));
}

function makeOperationId(method, path) {
  const parts = path
    .replace(/\{([^}]+)\}/g, ' by $1 ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  return method.toLowerCase() + parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function queryParameter(name) {
  const schema = INTEGER_QUERY_PARAMETERS.has(name)
    ? { type: 'integer', minimum: 1 }
    : NUMBER_QUERY_PARAMETERS.has(name)
      ? { type: 'number' }
      : { type: 'string' };

  return {
    name,
    in: 'query',
    required: false,
    schema
  };
}

function pathParameters(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' }
  }));
}

function mergeParameters(generated, documented = []) {
  const result = new Map();
  for (const parameter of [...generated, ...documented]) {
    const key = parameter.$ref || `${parameter.in}:${parameter.name}`;
    result.set(key, parameter);
  }
  return [...result.values()];
}

function genericJsonRequestBody(schema = { type: 'object', additionalProperties: true }) {
  return {
    required: false,
    content: {
      'application/json': { schema }
    }
  };
}

function multipartRequestBody() {
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary' }
          },
          additionalProperties: true
        }
      }
    }
  };
}

function successResponse(operationKey) {
  const mediaType = BINARY_OPERATIONS.get(operationKey);
  if (mediaType) {
    return {
      description: 'Binary response',
      content: {
        [mediaType]: {
          schema: { type: 'string', format: 'binary' }
        }
      }
    };
  }

  if (REDIRECT_OR_HTML_OPERATIONS.has(operationKey)) {
    return {
      description: 'Redirect or HTML response used by a browser flow',
      headers: {
        Location: { schema: { type: 'string', format: 'uri-reference' } }
      },
      content: {
        'text/html': { schema: { type: 'string' } }
      }
    };
  }

  const responseRefs = {
    'GET /company/members': '#/components/responses/CompanyMembersList',
    'GET /products': '#/components/responses/ProductList',
    'GET /products/{id}': '#/components/responses/Product',
    'POST /products': '#/components/responses/Product',
    'PUT /products/{id}': '#/components/responses/Product'
  };

  return {
    $ref: responseRefs[operationKey] || '#/components/responses/GenericSuccess'
  };
}

function commonResponses(operationKey) {
  const responses = {
    '2XX': successResponse(operationKey),
    400: { $ref: '#/components/responses/BadRequest' },
    404: { $ref: '#/components/responses/NotFound' },
    422: { $ref: '#/components/responses/ValidationError' },
    429: { $ref: '#/components/responses/TooManyRequests' },
    500: { $ref: '#/components/responses/InternalError' }
  };

  if (!PUBLIC_OPERATIONS.has(operationKey)) {
    responses[401] = { $ref: '#/components/responses/Unauthorized' };
    responses[403] = { $ref: '#/components/responses/Forbidden' };
  }

  return responses;
}

function generatedOperation(operation) {
  const parameters = [
    ...pathParameters(operation.path),
    ...operation.queryNames.map(queryParameter)
  ];
  const result = {
    tags: [operation.tag],
    summary: `${operation.method.toUpperCase()} ${operation.path}`,
    operationId: makeOperationId(operation.method, operation.path),
    security: PUBLIC_OPERATIONS.has(operation.operationKey) ? [] : [{ bearerAuth: [] }],
    parameters,
    responses: commonResponses(operation.operationKey)
  };

  if (MULTIPART_OPERATIONS.has(operation.operationKey)) {
    result.requestBody = multipartRequestBody();
  } else if (['post', 'put', 'patch'].includes(operation.method)) {
    result.requestBody = genericJsonRequestBody(REQUEST_BODY_OVERRIDES[operation.operationKey]);
  }

  return result;
}

function mergeOperation(generated, documented = {}) {
  return {
    ...generated,
    ...documented,
    tags: documented.tags || generated.tags,
    operationId: documented.operationId || generated.operationId,
    security: documented.security || generated.security,
    parameters: mergeParameters(generated.parameters, documented.parameters),
    responses: {
      ...generated.responses,
      ...(documented.responses || {})
    }
  };
}

function contractComponents() {
  const errorResponse = (description, example) => ({
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example
      }
    }
  });

  return {
    schemas: {
      GenericData: {
        description: 'Endpoint-specific payload retained as an extensible object until its domain schema is specialized.',
        type: 'object',
        additionalProperties: true
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1 },
          total: { type: 'integer', minimum: 0 },
          total_pages: { type: 'integer', minimum: 0 }
        },
        additionalProperties: true
      },
      ErrorDetail: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Request validation failed' },
          details: { nullable: true }
        },
        additionalProperties: false
      },
      ErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: { $ref: '#/components/schemas/ErrorDetail' }
        },
        additionalProperties: false
      },
      GenericSuccessResponse: {
        type: 'object',
        required: ['success'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/GenericData' },
          message: { type: 'string' },
          meta: { $ref: '#/components/schemas/GenericData' }
        },
        additionalProperties: false,
        example: { success: true, data: {} }
      },
      Product: {
        type: 'object',
        required: ['id', 'productCode', 'productName', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          productCode: { type: 'string' },
          productName: { type: 'string' },
          productType: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['draft', 'published', 'active', 'archived'] },
          quantity: { type: 'integer', minimum: 0 },
          weightPerUnit: { type: 'number', minimum: 0 },
          totalCo2e: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        },
        additionalProperties: true,
        example: {
          id: '11111111-1111-4111-8111-111111111111',
          productCode: 'SKU-001',
          productName: 'Organic cotton T-shirt',
          productType: 'tshirt',
          status: 'draft',
          quantity: 1000,
          weightPerUnit: 250
        }
      },
      ProductListData: {
        type: 'object',
        required: ['items', 'pagination'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
          pagination: { $ref: '#/components/schemas/PaginationMeta' }
        },
        additionalProperties: false
      },
      CompanyMember: {
        type: 'object',
        required: ['id', 'user_id', 'role', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          full_name: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
          role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
          status: { type: 'string', enum: ['active', 'invited', 'disabled'] },
          last_login: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' }
        },
        additionalProperties: false
      },
      CompanyMemberMeta: {
        type: 'object',
        required: ['total', 'active', 'invited', 'disabled'],
        properties: {
          total: { type: 'integer', minimum: 0 },
          active: { type: 'integer', minimum: 0 },
          invited: { type: 'integer', minimum: 0 },
          disabled: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      }
    },
    responses: {
      GenericSuccess: {
        description: 'Successful JSON response using the standard API envelope',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/GenericSuccessResponse' } }
        }
      },
      Product: {
        description: 'Product response',
        content: {
          'application/json': {
            schema: {
              allOf: [
                { $ref: '#/components/schemas/GenericSuccessResponse' },
                { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } }
              ]
            }
          }
        }
      },
      ProductList: {
        description: 'Paginated product list',
        content: {
          'application/json': {
            schema: {
              allOf: [
                { $ref: '#/components/schemas/GenericSuccessResponse' },
                { type: 'object', properties: { data: { $ref: '#/components/schemas/ProductListData' } } }
              ]
            },
            example: {
              success: true,
              data: {
                items: [{
                  id: '11111111-1111-4111-8111-111111111111',
                  productCode: 'SKU-001',
                  productName: 'Organic cotton T-shirt',
                  status: 'draft'
                }],
                pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 }
              }
            }
          }
        }
      },
      CompanyMembersList: {
        description: 'Company member list with aggregate counts',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'data', 'meta'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: { type: 'array', items: { $ref: '#/components/schemas/CompanyMember' } },
                meta: { $ref: '#/components/schemas/CompanyMemberMeta' }
              },
              additionalProperties: false
            },
            example: {
              success: true,
              data: [{
                id: '22222222-2222-4222-8222-222222222222',
                user_id: '33333333-3333-4333-8333-333333333333',
                full_name: 'Example Member',
                email: 'member@example.com',
                role: 'member',
                status: 'active',
                last_login: null,
                created_at: '2026-08-28T00:00:00.000Z'
              }],
              meta: { total: 1, active: 1, invited: 0, disabled: 0 }
            }
          }
        }
      },
      BadRequest: errorResponse('Bad request', {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Request failed' }
      }),
      Unauthorized: errorResponse('Authentication is missing, invalid or expired', {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      }),
      Forbidden: errorResponse('Authenticated principal lacks permission', {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      }),
      NotFound: errorResponse('Resource or route not found', {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Resource not found' }
      }),
      ValidationError: errorResponse('Validation failed', {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [] }
      }),
      TooManyRequests: errorResponse('Rate limit exceeded', {
        success: false,
        error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' }
      }),
      InternalError: errorResponse('Unexpected server error', {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
      })
    }
  };
}

function mergeComponents(existing = {}, generated) {
  const result = { ...existing };
  for (const [section, values] of Object.entries(generated)) {
    result[section] = {
      ...(existing[section] || {}),
      ...values
    };
  }
  return result;
}

function buildOpenApiContract(documentedSpec, apiRoutes) {
  const spec = {
    ...documentedSpec,
    tags: apiRoutes.map(({ tag }) => ({ name: tag })),
    components: mergeComponents(documentedSpec.components, contractComponents()),
    paths: { ...(documentedSpec.paths || {}) }
  };

  for (const operation of collectRuntimeOperations(apiRoutes)) {
    const currentPath = spec.paths[operation.path] || {};
    currentPath[operation.method] = mergeOperation(
      generatedOperation(operation),
      currentPath[operation.method]
    );
    spec.paths[operation.path] = currentPath;
  }

  spec.paths['/health'] = {
    get: {
      tags: ['Health'],
      summary: 'Application and database health',
      operationId: 'getHealth',
      servers: [{ url: '/' }],
      security: [],
      responses: {
        200: {
          description: 'Application and database are healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenericSuccessResponse' },
              example: {
                success: true,
                data: {
                  status: 'healthy',
                  timestamp: '2026-08-28T00:00:00.000Z',
                  uptime: 120,
                  db: 'ok'
                }
              }
            }
          }
        },
        503: {
          description: 'Database is unavailable',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: {
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not reachable' }
              }
            }
          }
        }
      }
    }
  };

  spec.tags.push({ name: 'Health' });
  return spec;
}

function countOperations(spec) {
  return Object.values(spec.paths || {}).reduce(
    (total, pathItem) => total + Object.keys(pathItem).filter((key) => HTTP_METHODS.has(key)).length,
    0
  );
}

module.exports = {
  buildOpenApiContract,
  collectRuntimeOperations,
  countOperations,
  makeOperationId
};
