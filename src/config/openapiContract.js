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
  'GET /reports/v2/public/audit-pack-shares/{token}',
  'GET /reports/v2/public/audit-pack-shares/{token}/download',
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
  ['GET /reports/v2/public/audit-pack-shares/{token}/download', 'application/zip'],
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
  'GET /carbon-factors': ['registry_version', 'unit', 'geography', 'factor_class', 'is_proxy'],
  'GET /carbon-factors/{factorId}': ['registry_version'],
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
    carbonResults: {
      type: 'object',
      additionalProperties: true,
      deprecated: true,
      description: 'Optional client preview only. The server recomputes and replaces this value.'
    },
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

const CARBON_ENGINE_INPUT_SCHEMA = {
  type: 'object',
  required: [
    'unitMassKg',
    'quantity',
    'materials',
    'accessories',
    'processFactorIds',
    'energyMix',
    'transport'
  ],
  properties: {
    unitMassKg: { type: 'number', minimum: 0 },
    quantity: { type: 'number', minimum: 0 },
    reportingActorRole: {
      type: 'string',
      enum: ['manufacturer', 'brand', 'supplier', 'other']
    },
    productCategory: { type: 'string', enum: ['textile'] },
    materials: { type: 'array', items: { type: 'object', additionalProperties: true } },
    accessories: { type: 'array', items: { type: 'object', additionalProperties: true } },
    packaging: { type: 'object', nullable: true, additionalProperties: true },
    includePackagingFallbackNote: { type: 'boolean' },
    processFactorIds: { type: 'array', items: { type: 'string' } },
    energyMix: { type: 'array', items: { type: 'object', additionalProperties: true } },
    manufacturingGeography: { type: 'string' },
    originGeography: { type: 'string' },
    destinationMarket: { type: 'string' },
    transport: { type: 'array', items: { type: 'object', additionalProperties: true } }
  },
  additionalProperties: false
};

const CARRIER_DOCUMENT_PROPERTIES = {
  evidenceDocumentId: { type: 'string', format: 'uuid' },
  documentType: { type: 'string', enum: ['bill_of_lading', 'fbl', 'air_waybill', 'cmr', 'cim'] },
  contractLevel: { type: 'string', enum: ['master', 'house', 'direct'] },
  transportMode: { type: 'string', enum: ['sea', 'air', 'road', 'rail', 'multimodal'] },
  documentNumber: { type: 'string', minLength: 1, maxLength: 200 },
  issuerName: { type: 'string', maxLength: 500 },
  issuerIdentifier: { type: 'string', maxLength: 300 },
  issueDate: { type: 'string', format: 'date' },
  issuePlace: { type: 'string', maxLength: 500 },
  onBoardDate: { type: 'string', format: 'date' },
  shipper: { type: 'object', additionalProperties: true },
  consignee: { type: 'object', additionalProperties: true },
  notifyParty: { type: 'object', additionalProperties: true },
  vesselName: { type: 'string', maxLength: 300 },
  voyageNumber: { type: 'string', maxLength: 200 },
  flightNumber: { type: 'string', maxLength: 200 },
  vehicleRegistration: { type: 'string', maxLength: 200 },
  trainNumber: { type: 'string', maxLength: 200 },
  placeOfReceipt: { type: 'string', maxLength: 500 },
  placeOfLoading: { type: 'string', maxLength: 500 },
  placeOfDischarge: { type: 'string', maxLength: 500 },
  placeOfDelivery: { type: 'string', maxLength: 500 },
  goodsDescription: { type: 'string', maxLength: 5000 },
  packageCount: { type: 'integer', minimum: 1 },
  packageType: { type: 'string', maxLength: 200 },
  marksAndNumbers: { type: 'string', maxLength: 2000 },
  grossWeightKg: { type: 'number', minimum: 0, exclusiveMinimum: true },
  measurementCbm: { type: 'number', minimum: 0 },
  containerNumbers: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 100 } },
  sealNumbers: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 100 } },
  freightTerms: { type: 'string', enum: ['prepaid', 'collect', 'other'] },
  paymentTerms: { type: 'string', maxLength: 1000 },
  authenticationMethod: { type: 'string', maxLength: 500 },
  authenticationReference: { type: 'string', maxLength: 1000 },
  authenticityStatus: { type: 'string', enum: ['unverified', 'operator_confirmed', 'issuer_verified', 'rejected'] },
  originalStatus: { type: 'string', enum: ['original', 'copy', 'electronic', 'sea_waybill', 'non_negotiable', 'unknown'] },
  negotiable: { type: 'boolean', nullable: true },
  metadataSource: { type: 'string', enum: ['manual', 'ocr_confirmed', 'carrier_api'] },
  supersedesId: { type: 'string', format: 'uuid', nullable: true },
  metadata: { type: 'object', additionalProperties: true }
};

const VN_CUSTOMS_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'declarant', 'customsBroker', 'customsOfficeCode', 'declarationTypeCode',
    'cargoClassificationCode', 'transportMethodCode', 'exitCustomsOfficeCode',
    'loadingLocationCode', 'destinationCountryCode', 'invoiceClassificationCode',
    'invoicePaymentMethodCode', 'exchangeRate', 'permitRequirementStatus',
    'inspectionRequirementStatus', 'taxTreatment', 'supportingDocuments',
    'brokerTargetSchemaId', 'brokerTargetSchemaVersion'
  ],
  properties: {
    declarant: { type: 'object', additionalProperties: true },
    customsBroker: { type: 'object', additionalProperties: true },
    customsOfficeCode: { type: 'string', maxLength: 20 },
    declarationTypeCode: { type: 'string', maxLength: 20 },
    cargoClassificationCode: { type: 'string', maxLength: 20 },
    transportMethodCode: { type: 'string', maxLength: 20 },
    exitCustomsOfficeCode: { type: 'string', maxLength: 20 },
    loadingLocationCode: { type: 'string', maxLength: 20 },
    destinationCountryCode: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    invoiceClassificationCode: { type: 'string', maxLength: 20 },
    invoicePaymentMethodCode: { type: 'string', maxLength: 20 },
    exchangeRate: { type: 'number', minimum: 0, exclusiveMinimum: true },
    permitRequirementStatus: { type: 'string', enum: ['unknown', 'not_required', 'required'] },
    permitReferences: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: true } },
    inspectionRequirementStatus: { type: 'string', enum: ['unknown', 'not_required', 'required'] },
    inspectionReferences: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: true } },
    taxTreatment: { type: 'string', enum: ['unknown', 'not_subject', 'exempt', 'taxable'] },
    exportDutyRate: { type: 'number', minimum: 0, nullable: true },
    exportDutyAmount: { type: 'number', minimum: 0, nullable: true },
    taxBasis: { type: 'string', maxLength: 5000 },
    supportingDocuments: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: true } },
    brokerTargetSchemaId: { type: 'string', minLength: 1, maxLength: 300 },
    brokerTargetSchemaVersion: { type: 'string', minLength: 1, maxLength: 100 },
    declarationNotes: { type: 'string', maxLength: 5000 },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const EU_IMPORT_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'memberStateCode', 'importer', 'declarant', 'representationType', 'customsOfficeCode',
    'declarationDatasetCode', 'additionalDeclarationType', 'requestedProcedureCode',
    'previousProcedureCode', 'modeOfTransportAtBorder', 'inlandModeOfTransport',
    'borderTransportIdentity', 'placeOfGoodsCode', 'valuationMethodCode', 'exchangeRate',
    'customsValueCurrency', 'customsValueAmount', 'dutyTreatment', 'vatTreatment',
    'restrictionStatus', 'preferenceClaimStatus', 'guaranteeRequirementStatus',
    'supportingDocuments', 'targetSystemSchemaId', 'targetSystemSchemaVersion'
  ],
  properties: {
    memberStateCode: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    importer: { type: 'object', additionalProperties: true },
    declarant: { type: 'object', additionalProperties: true },
    representative: { type: 'object', additionalProperties: true },
    representationType: { type: 'string', enum: ['none', 'direct', 'indirect'] },
    customsOfficeCode: { type: 'string', maxLength: 35 },
    declarationDatasetCode: { type: 'string', maxLength: 35 },
    additionalDeclarationType: { type: 'string', maxLength: 35 },
    requestedProcedureCode: { type: 'string', maxLength: 35 },
    previousProcedureCode: { type: 'string', maxLength: 35 },
    modeOfTransportAtBorder: { type: 'string', maxLength: 35 },
    inlandModeOfTransport: { type: 'string', maxLength: 35 },
    borderTransportIdentity: { type: 'string', maxLength: 500 },
    placeOfGoodsCode: { type: 'string', maxLength: 35 },
    deliveryTermsLocation: { type: 'string', maxLength: 500 },
    valuationMethodCode: { type: 'string', maxLength: 35 },
    exchangeRate: { type: 'number', minimum: 0, exclusiveMinimum: true },
    customsValueCurrency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    customsValueAmount: { type: 'number', minimum: 0 },
    dutyTreatment: { type: 'string', enum: ['unknown', 'not_subject', 'exempt', 'payable'] },
    dutyRate: { type: 'number', minimum: 0, nullable: true },
    dutyAmount: { type: 'number', minimum: 0, nullable: true },
    vatTreatment: { type: 'string', enum: ['unknown', 'not_subject', 'exempt', 'payable'] },
    vatRate: { type: 'number', minimum: 0, nullable: true },
    vatAmount: { type: 'number', minimum: 0, nullable: true },
    taxBasis: { type: 'string', maxLength: 5000 },
    restrictionStatus: { type: 'string', enum: ['unknown', 'not_required', 'required'] },
    restrictionReferences: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: true } },
    preferenceClaimStatus: { type: 'string', enum: ['no_claim', 'claimed'] },
    preferenceReferences: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: true } },
    guaranteeRequirementStatus: { type: 'string', enum: ['unknown', 'not_required', 'required'] },
    guaranteeReferences: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: true } },
    supportingDocuments: { type: 'array', maxItems: 300, items: { type: 'object', additionalProperties: true } },
    targetSystemSchemaId: { type: 'string', minLength: 1, maxLength: 300 },
    targetSystemSchemaVersion: { type: 'string', minLength: 1, maxLength: 100 },
    declarationNotes: { type: 'string', maxLength: 5000 },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const EU_IMPORT_EVENT_SCHEMA = {
  type: 'object',
  required: ['exportDocumentId', 'eventType', 'externalReference', 'evidenceDocumentId', 'actorName', 'occurredAt'],
  properties: {
    exportDocumentId: { type: 'string', format: 'uuid' },
    eventType: {
      type: 'string',
      enum: [
        'declarant_received', 'declarant_validated', 'declarant_rejected',
        'authority_submitted', 'authority_accepted', 'authority_rejected',
        'authority_released', 'authority_cancelled', 'amendment_requested', 'amendment_submitted'
      ]
    },
    externalReference: { type: 'string', minLength: 1, maxLength: 500 },
    messageCode: { type: 'string', maxLength: 200 },
    messageText: { type: 'string', maxLength: 5000 },
    evidenceDocumentId: { type: 'string', format: 'uuid' },
    actorName: { type: 'string', minLength: 1, maxLength: 500 },
    actorIdentifier: { type: 'string', maxLength: 300 },
    occurredAt: { type: 'string', format: 'date-time' },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const ICS2_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'transportMode', 'messageDatasetCode', 'filingRole', 'filingArrangement',
    'localReferenceNumber', 'sender', 'declarant', 'customsOfficeFirstEntry',
    'firstEntryCountry', 'estimatedArrivalAt', 'itineraryCountries', 'conveyanceReference',
    'masterTransportDocument', 'activeBorderTransportMeans', 'houseConsignments',
    'targetSystemSchemaId', 'targetSystemSchemaVersion', 'technicalPackageId', 'technicalPackageVersion'
  ],
  properties: {
    transportMode: { type: 'string', enum: ['sea', 'inland_waterway', 'air', 'road', 'rail'] },
    messageDatasetCode: { type: 'string', pattern: '^F(1[0-6]|2[0-9]|3[0-4]|4[0-5]|5[01])$' },
    filingRole: { type: 'string', enum: ['carrier', 'house_level_filer', 'express_carrier', 'postal_operator', 'representative'] },
    filingArrangement: { type: 'string', enum: ['single', 'multiple'] },
    localReferenceNumber: { type: 'string', minLength: 1, maxLength: 100 },
    sender: { type: 'object', additionalProperties: true },
    declarant: { type: 'object', additionalProperties: true },
    representative: { type: 'object', additionalProperties: true },
    customsOfficeFirstEntry: { type: 'string', minLength: 1, maxLength: 35 },
    firstEntryCountry: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    estimatedArrivalAt: { type: 'string', format: 'date-time' },
    itineraryCountries: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
    conveyanceReference: { type: 'string', minLength: 1, maxLength: 100 },
    containerIndicator: { type: 'boolean' },
    masterTransportDocument: { type: 'object', additionalProperties: true },
    activeBorderTransportMeans: { type: 'object', additionalProperties: true },
    seals: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 100 } },
    paymentMethodCode: { type: 'string', maxLength: 35 },
    houseConsignments: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', additionalProperties: true } },
    targetSystemSchemaId: { type: 'string', minLength: 1, maxLength: 300 },
    targetSystemSchemaVersion: { type: 'string', minLength: 1, maxLength: 100 },
    technicalPackageId: { type: 'string', minLength: 1, maxLength: 300 },
    technicalPackageVersion: { type: 'string', minLength: 1, maxLength: 100 },
    messageNamespace: { type: 'string', maxLength: 500 },
    filingNotes: { type: 'string', maxLength: 5000 },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const ICS2_EVENT_SCHEMA = {
  type: 'object',
  required: ['exportDocumentId', 'eventType', 'externalReference', 'evidenceDocumentId', 'actorName', 'occurredAt'],
  properties: {
    exportDocumentId: { type: 'string', format: 'uuid' },
    eventType: {
      type: 'string',
      enum: [
        'filer_received', 'filer_validated', 'filer_rejected',
        'authority_registered', 'authority_rejected', 'risk_referral', 'do_not_load',
        'assessment_complete', 'amendment_requested', 'amendment_registered',
        'invalidation_requested', 'invalidated'
      ]
    },
    externalReference: { type: 'string', minLength: 1, maxLength: 500 },
    messageCode: { type: 'string', maxLength: 200 },
    messageText: { type: 'string', maxLength: 5000 },
    evidenceDocumentId: { type: 'string', format: 'uuid' },
    actorName: { type: 'string', minLength: 1, maxLength: 500 },
    actorIdentifier: { type: 'string', maxLength: 300 },
    occurredAt: { type: 'string', format: 'date-time' },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const ORIGIN_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'claimType', 'invoiceTotalEur', 'territorialityConfirmed', 'nonAlterationConfirmed',
    'insufficientProcessingExcluded', 'lineAssessments'
  ],
  properties: {
    claimType: { type: 'string', enum: ['certificate_application', 'origin_declaration_draft'] },
    invoiceTotalEur: { type: 'number', minimum: 0, exclusiveMinimum: true },
    exporterAuthorizationType: { type: 'string', enum: ['none', 'approved', 'registered'] },
    exporterAuthorizationReference: { type: 'string', maxLength: 500 },
    territorialityConfirmed: { type: 'boolean' },
    nonAlterationConfirmed: { type: 'boolean' },
    insufficientProcessingExcluded: { type: 'boolean' },
    lineAssessments: {
      type: 'array', maxItems: 1000,
      items: {
        type: 'object',
        required: ['exportLineId', 'ruleCode', 'ruleSourcePage', 'productionProcesses', 'exWorksPrice', 'nonOriginatingMaterialValue', 'materials'],
        properties: {
          exportLineId: { type: 'string', format: 'uuid' },
          ruleCode: { type: 'string', enum: [
            'CH61_CUT_SEWN_KNITTING_AND_MAKING_UP',
            'CH61_KNITTED_TO_SHAPE_SPINNING_OR_EXTRUSION_AND_KNITTING',
            'CH62_GENERAL_WEAVING_AND_MAKING_UP',
            'CH64_GENERAL_EXCLUDES_6406_UPPER_ASSEMBLY', 'SPECIALIST_RULE_REVIEW'
          ] },
          ruleSourcePage: { type: 'string', minLength: 1, maxLength: 500 },
          specialistRuleText: { type: 'string', maxLength: 5000 },
          productionProcesses: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 200 } },
          exWorksPrice: { type: 'number', minimum: 0, exclusiveMinimum: true },
          nonOriginatingMaterialValue: { type: 'number', minimum: 0 },
          materials: {
            type: 'array', minItems: 1, maxItems: 5000,
            items: {
              type: 'object',
              required: ['reference', 'description', 'hsCode', 'originCountry', 'originStatus', 'value', 'evidenceDocumentId'],
              properties: {
                id: { type: 'string', maxLength: 200 }, reference: { type: 'string', minLength: 1, maxLength: 500 },
                description: { type: 'string', minLength: 1, maxLength: 2000 },
                hsCode: { type: 'string', pattern: '^[0-9 .-]{4,20}$' }, supplierName: { type: 'string', maxLength: 500 },
                originCountry: { type: 'string', pattern: '^[A-Za-z]{2}$' },
                originStatus: { type: 'string', enum: ['originating', 'non_originating', 'cumulated', 'unknown'] },
                cumulationBasis: { type: 'string', enum: ['none', 'eu_bilateral', 'asean_article_3_2', 'korea_fabric_article_3_7'] },
                value: { type: 'number', minimum: 0 }, weightKg: { type: 'number', minimum: 0 },
                evidenceDocumentId: { type: 'string', format: 'uuid' },
                isUpperAssemblyAffixedToSole: { type: 'boolean', nullable: true }, notes: { type: 'string', maxLength: 5000 }
              },
              additionalProperties: false
            }
          },
          notes: { type: 'string', maxLength: 5000 }
        },
        additionalProperties: false
      }
    },
    notes: { type: 'string', maxLength: 5000 },
    metadata: { type: 'object', additionalProperties: true }
  },
  additionalProperties: false
};

const REQUEST_BODY_OVERRIDES = {
  'POST /reports/v2/snapshots': {
    type: 'object',
    required: ['productId', 'payload'],
    properties: {
      productId: { type: 'string', format: 'uuid' },
      payload: {
        type: 'object',
        additionalProperties: true,
        description: 'Presentation payload. Carbon totals are replaced by the authoritative server snapshot.'
      }
    },
    additionalProperties: true
  },
  'POST /reports/v2/audit-packs': {
    type: 'object',
    required: ['productId'],
    properties: {
      productId: { type: 'string', format: 'uuid' }
    },
    additionalProperties: false
  },
  'POST /reports/v2/audit-packs/{id}/reviews': {
    type: 'object',
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['approved', 'rejected'] },
      notes: { type: 'string', maxLength: 5000 },
      qaExceptions: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 100 },
            message: { type: 'string', minLength: 1, maxLength: 1000 },
            severity: { type: 'string', enum: ['warning', 'blocking'] },
            status: { type: 'string', enum: ['open', 'resolved'] }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  },
  'POST /reports/v2/audit-packs/{id}/issue': {
    type: 'object',
    required: ['assertion', 'criteria', 'signatureAcknowledged'],
    properties: {
      assertion: { type: 'string', minLength: 1, maxLength: 5000 },
      criteria: { type: 'string', minLength: 1, maxLength: 5000 },
      signatureAcknowledged: {
        type: 'boolean',
        enum: [true],
        description: 'Explicit acknowledgement that this creates an internal platform attestation, not a qualified electronic signature.'
      }
    },
    additionalProperties: false
  },
  'POST /reports/v2/audit-packs/{id}/shares': {
    type: 'object',
    required: ['expiresInHours'],
    properties: {
      label: { type: 'string', maxLength: 200 },
      expiresInHours: { type: 'integer', minimum: 1, maximum: 720 },
      maxDownloads: { type: 'integer', minimum: 1, maximum: 100, nullable: true }
    },
    additionalProperties: false
  },
  'POST /reports/v2/audit-packs/{id}/assurance-records': {
    type: 'object',
    required: ['outcome', 'providerName', 'scope'],
    properties: {
      outcome: {
        type: 'string',
        enum: [
          'requested', 'evidence_received', 'limited_assurance', 'reasonable_assurance',
          'qualified', 'adverse', 'withdrawn'
        ]
      },
      providerName: { type: 'string', minLength: 1, maxLength: 300 },
      practitionerName: { type: 'string', maxLength: 300 },
      standard: { type: 'string', maxLength: 500 },
      scope: { type: 'string', minLength: 1, maxLength: 5000 },
      statementDate: { type: 'string', format: 'date' },
      validTo: { type: 'string', format: 'date' },
      evidenceDocumentId: { type: 'string', format: 'uuid' },
      notes: { type: 'string', maxLength: 5000 }
    },
    additionalProperties: false
  },
  'POST /export/dpp-locks': {
    type: 'object',
    properties: {
      productId: { type: 'string', format: 'uuid' },
      product_id: { type: 'string', format: 'uuid' },
      sku: { type: 'string' },
      gtin: { type: 'string' },
      decentralizedUrl: { type: 'string', format: 'uri' }
    },
    additionalProperties: false,
    description: 'Product carbon values are always loaded from the authoritative server snapshot.'
  },
  'POST /export/shipments/{shipmentId}/carrier-documents': {
    type: 'object',
    required: ['evidenceDocumentId', 'documentType', 'transportMode', 'documentNumber'],
    properties: CARRIER_DOCUMENT_PROPERTIES,
    additionalProperties: false
  },
  'PATCH /export/shipments/{shipmentId}/carrier-documents/{carrierDocumentId}': {
    type: 'object',
    minProperties: 1,
    properties: CARRIER_DOCUMENT_PROPERTIES,
    additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/carrier-documents/{carrierDocumentId}/confirm': {
    type: 'object',
    required: ['metadataConfirmed', 'confirmationNote'],
    properties: {
      metadataConfirmed: { type: 'boolean', enum: [true] },
      confirmationNote: { type: 'string', minLength: 1, maxLength: 5000 }
    },
    additionalProperties: false
  },
  'PUT /export/shipments/{shipmentId}/vn-customs/profile': VN_CUSTOMS_PROFILE_SCHEMA,
  'POST /export/shipments/{shipmentId}/vn-customs/events': {
    type: 'object',
    required: [
      'exportDocumentId', 'eventType', 'externalReference', 'evidenceDocumentId',
      'actorName', 'occurredAt'
    ],
    properties: {
      exportDocumentId: { type: 'string', format: 'uuid' },
      eventType: {
        type: 'string',
        enum: [
          'broker_received', 'broker_validated', 'broker_rejected',
          'authority_submitted', 'authority_accepted', 'authority_rejected',
          'authority_released', 'authority_cancelled',
          'amendment_requested', 'amendment_submitted'
        ]
      },
      externalReference: { type: 'string', minLength: 1, maxLength: 500 },
      messageCode: { type: 'string', maxLength: 200 },
      messageText: { type: 'string', maxLength: 5000 },
      evidenceDocumentId: { type: 'string', format: 'uuid' },
      actorName: { type: 'string', minLength: 1, maxLength: 500 },
      actorIdentifier: { type: 'string', maxLength: 300 },
      occurredAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  },
  'PUT /export/shipments/{shipmentId}/eu-import/profile': EU_IMPORT_PROFILE_SCHEMA,
  'PUT /export/shipments/{shipmentId}/eu-import/lines/{lineId}': {
    type: 'object',
    properties: {
      taricCode: { type: 'string', pattern: '^[0-9 .-]{1,20}$' },
      taricSource: { type: 'string', maxLength: 500 },
      taricVersion: { type: 'string', maxLength: 200 },
      taricEffectiveDate: { type: 'string', format: 'date' },
      taricConfirmed: { type: 'boolean' },
      supplementaryUnitCode: { type: 'string', maxLength: 35 },
      additionalCodes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 35 } },
      nationalAdditionalCodes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 35 } },
      preferenceCode: { type: 'string', maxLength: 35 },
      requestedProcedureCode: { type: 'string', maxLength: 35 },
      previousProcedureCode: { type: 'string', maxLength: 35 },
      metadata: { type: 'object', additionalProperties: true }
    },
    minProperties: 1,
    additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/eu-import/events': EU_IMPORT_EVENT_SCHEMA,
  'PUT /export/shipments/{shipmentId}/ics2/profile': ICS2_PROFILE_SCHEMA,
  'POST /export/shipments/{shipmentId}/ics2/events': ICS2_EVENT_SCHEMA,
  'PUT /export/shipments/{shipmentId}/origin/profile': ORIGIN_PROFILE_SCHEMA,
  'POST /export/shipments/{shipmentId}/compliance/applicability-evaluations': {
    type: 'object',
    required: [
      'assessmentDate', 'productCategory', 'intendedUse', 'consumerGroup', 'importerRole',
      'salesChannels', 'consumerProduct', 'placedOnEuMarket'
    ],
    properties: {
      assessmentDate: { type: 'string', format: 'date' },
      productCategory: { type: 'string', minLength: 1, maxLength: 200 },
      intendedUse: { type: 'string', minLength: 1, maxLength: 500 },
      consumerGroup: { type: 'string', minLength: 1, maxLength: 200 },
      importerRole: { type: 'string', minLength: 1, maxLength: 200 },
      salesChannels: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 100 } },
      consumerProduct: { type: 'boolean' },
      placedOnEuMarket: { type: 'boolean' },
      textileFibrePercent: { type: 'number', minimum: 0, maximum: 100, nullable: true },
      materialFacts: {
        type: 'array', maxItems: 500,
        items: {
          type: 'object',
          properties: {
            reference: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 1000 },
            hsCode: { type: 'string', pattern: '^[0-9 .-]{0,20}$' },
            originCountry: { type: 'string', pattern: '^[A-Za-z]{0,2}$' },
            percentageByWeight: { type: 'number', minimum: 0, maximum: 100, nullable: true },
            animalOrigin: { type: 'boolean', nullable: true },
            substancesScreened: { type: 'boolean', nullable: true }
          },
          additionalProperties: false
        }
      },
      notes: { type: 'string', maxLength: 5000 }
    },
    additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/compliance/applicability-evaluations/{evaluationId}/reviews': {
    type: 'object',
    required: ['reviewerRole', 'decision', 'notes'],
    properties: {
      reviewerRole: { type: 'string', enum: ['compliance_specialist'] },
      decision: {
        type: 'string',
        enum: ['confirmed_for_internal_planning', 'needs_information', 'rejected']
      },
      notes: { type: 'string', minLength: 1, maxLength: 5000 },
      evidenceDocumentIds: {
        type: 'array', maxItems: 50, uniqueItems: true,
        items: { type: 'string', format: 'uuid' }
      }
    },
    additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/textile-fibre-labels': {
    type: 'object',
    required: [
      'specificationReference', 'assessmentDate', 'productReference', 'productCategory',
      'specialProductCategory', 'textileFibrePercent', 'marketCodes', 'components',
      'animalOriginPresence', 'languageLabels', 'economicOperator', 'placement', 'evidenceDocumentIds'
    ],
    properties: {
      specificationReference: { type: 'string', minLength: 1, maxLength: 120 },
      assessmentDate: { type: 'string', format: 'date' },
      productReference: { type: 'string', minLength: 1, maxLength: 500 },
      productCategory: { type: 'string', minLength: 1, maxLength: 500 },
      specialProductCategory: { type: 'string', enum: ['standard', 'annex_iv', 'annex_v', 'annex_vi', 'unknown'] },
      textileFibrePercent: { type: 'number', minimum: 0, maximum: 100 },
      marketCodes: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
      components: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object', required: ['componentReference', 'componentName', 'weightPercent', 'mainLining', 'fibres'],
          properties: {
            componentReference: { type: 'string', minLength: 1, maxLength: 200 },
            componentName: { type: 'string', minLength: 1, maxLength: 500 },
            weightPercent: { type: 'number', minimum: 0, maximum: 100 },
            mainLining: { type: 'boolean' },
            fibres: {
              type: 'array', maxItems: 50,
              items: {
                type: 'object', required: ['fibreCode', 'percentage'],
                properties: {
                  fibreCode: { type: 'string', minLength: 1, maxLength: 100 },
                  percentage: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 100 }
                }, additionalProperties: false
              }
            }
          }, additionalProperties: false
        }
      },
      animalOriginPresence: { type: 'string', enum: ['present', 'absent', 'unknown'] },
      languageLabels: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object', required: ['marketCode', 'languageCode', 'labelText', 'animalOriginStatementIncluded', 'operatorApproved'],
          properties: {
            marketCode: { type: 'string', pattern: '^[A-Za-z]{2}$' },
            languageCode: { type: 'string', minLength: 2, maxLength: 35 },
            labelText: { type: 'string', minLength: 1, maxLength: 10000 },
            animalOriginStatementIncluded: { type: 'boolean' },
            operatorApproved: { type: 'boolean' }
          }, additionalProperties: false
        }
      },
      economicOperator: {
        type: 'object', required: ['role', 'name', 'address'],
        properties: {
          role: { type: 'string', minLength: 1, maxLength: 100 },
          name: { type: 'string', minLength: 1, maxLength: 500 },
          address: { type: 'string', minLength: 1, maxLength: 2000 }
        }, additionalProperties: false
      },
      placement: {
        type: 'object',
        required: ['method', 'durable', 'easilyLegible', 'visible', 'accessible', 'securelyAttached', 'onlineBeforePurchase'],
        properties: {
          method: { type: 'string', minLength: 1, maxLength: 100 }, durable: { type: 'boolean' },
          easilyLegible: { type: 'boolean' }, visible: { type: 'boolean' }, accessible: { type: 'boolean' },
          securelyAttached: { type: 'boolean' }, onlineBeforePurchase: { type: 'boolean' }
        }, additionalProperties: false
      },
      evidenceDocumentIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
      notes: { type: 'string', maxLength: 5000 }
    }, additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/textile-fibre-labels/{specificationId}/reviews': {
    type: 'object', required: ['reviewerRole', 'decision', 'notes'],
    properties: {
      reviewerRole: { type: 'string', enum: ['textile_label_reviewer'] },
      decision: { type: 'string', enum: ['approved_for_internal_artwork', 'needs_information', 'rejected'] },
      notes: { type: 'string', minLength: 1, maxLength: 5000 }
    }, additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/gpsr/technical-files': {
    type: 'object',
    required: ['fileReference', 'assessmentDate', 'firstPlacedOnMarketDate', 'consumerProduct',
      'placedOnEuMarket', 'marketCodes', 'harmonisationCoverage', 'product', 'intendedUse',
      'foreseeableMisuse', 'operators', 'risks', 'standards', 'warnings', 'onlineOffer',
      'seriesProductionProcedure', 'complaintChannel', 'postMarketPlan', 'retentionUntil', 'evidenceDocumentIds'],
    properties: {
      fileReference: { type: 'string', minLength: 1, maxLength: 120 },
      assessmentDate: { type: 'string', format: 'date' },
      firstPlacedOnMarketDate: { type: 'string', format: 'date' },
      consumerProduct: { type: 'boolean' }, placedOnEuMarket: { type: 'boolean' },
      marketCodes: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
      harmonisationCoverage: { type: 'string', enum: ['none', 'partial', 'full', 'unknown'] },
      applicableSectorRules: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 500 } },
      product: {
        type: 'object', required: ['brand', 'name', 'model', 'description', 'essentialCharacteristics', 'productImageEvidenceId', 'packagingImageEvidenceId'],
        properties: {
          brand: { type: 'string', minLength: 1, maxLength: 500 }, name: { type: 'string', minLength: 1, maxLength: 500 },
          model: { type: 'string', minLength: 1, maxLength: 500 }, type: { type: 'string', maxLength: 500 },
          batchNumber: { type: 'string', maxLength: 500 }, serialNumber: { type: 'string', maxLength: 500 },
          otherIdentifier: { type: 'string', maxLength: 500 }, description: { type: 'string', minLength: 1, maxLength: 5000 },
          essentialCharacteristics: { type: 'string', minLength: 1, maxLength: 10000 }, composition: { type: 'string', maxLength: 10000 },
          packagingDescription: { type: 'string', maxLength: 5000 },
          productImageEvidenceId: { type: 'string', format: 'uuid' }, packagingImageEvidenceId: { type: 'string', format: 'uuid' }
        }, additionalProperties: false
      },
      intendedUse: { type: 'string', minLength: 1, maxLength: 5000 }, foreseeableMisuse: { type: 'string', minLength: 1, maxLength: 5000 },
      vulnerableGroups: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 500 } },
      operators: {
        type: 'object', required: ['manufacturer', 'importer', 'responsiblePerson'],
        properties: {
          manufacturer: { $ref: '#/components/schemas/GpsrEconomicOperator' },
          importer: { $ref: '#/components/schemas/GpsrEconomicOperator' },
          responsiblePerson: { $ref: '#/components/schemas/GpsrEconomicOperator' }
        }, additionalProperties: false
      },
      risks: {
        type: 'array', minItems: 1, maxItems: 200,
        items: { type: 'object', required: ['hazardId', 'hazardCategory', 'hazardDescription', 'affectedGroups', 'foreseeableScenario', 'likelihood', 'severity', 'mitigation', 'residualLikelihood', 'residualSeverity', 'verificationEvidenceIds'],
          properties: {
            hazardId: { type: 'string', minLength: 1, maxLength: 200 }, hazardCategory: { type: 'string', minLength: 1, maxLength: 500 },
            hazardDescription: { type: 'string', minLength: 1, maxLength: 5000 }, affectedGroups: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', maxLength: 500 } },
            foreseeableScenario: { type: 'string', minLength: 1, maxLength: 5000 }, likelihood: { type: 'integer', minimum: 1, maximum: 5 },
            severity: { type: 'integer', minimum: 1, maximum: 5 }, mitigation: { type: 'string', minLength: 1, maxLength: 10000 },
            residualLikelihood: { type: 'integer', minimum: 1, maximum: 5 }, residualSeverity: { type: 'integer', minimum: 1, maximum: 5 },
            verificationEvidenceIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' } }
          }, additionalProperties: false }
      },
      standards: { type: 'array', maxItems: 100, items: { type: 'object', required: ['reference', 'version', 'applicationExtent'], properties: {
        reference: { type: 'string', minLength: 1, maxLength: 500 }, title: { type: 'string', maxLength: 1000 }, version: { type: 'string', minLength: 1, maxLength: 200 },
        applicationExtent: { type: 'string', enum: ['full', 'partial'] }, appliedParts: { type: 'string', maxLength: 5000 }
      }, additionalProperties: false } },
      warnings: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', required: ['marketCode', 'languageCode', 'text', 'location', 'operatorApproved'], properties: {
        marketCode: { type: 'string', pattern: '^[A-Za-z]{2}$' }, languageCode: { type: 'string', minLength: 2, maxLength: 35 },
        text: { type: 'string', minLength: 1, maxLength: 10000 }, location: { type: 'string', enum: ['product', 'packaging', 'accompanying_document', 'online_offer'] }, operatorApproved: { type: 'boolean' }
      }, additionalProperties: false } },
      onlineOffer: { type: 'object', required: ['enabled', 'manufacturerDisplayed', 'responsiblePersonDisplayed', 'productImageDisplayed', 'identifiersDisplayed', 'warningsDisplayed'], properties: {
        enabled: { type: 'boolean' }, manufacturerDisplayed: { type: 'boolean' }, responsiblePersonDisplayed: { type: 'boolean' },
        productImageDisplayed: { type: 'boolean' }, identifiersDisplayed: { type: 'boolean' }, warningsDisplayed: { type: 'boolean' },
        offerUrl: { type: 'string', maxLength: 2000 }
      }, additionalProperties: false },
      seriesProductionProcedure: { type: 'string', minLength: 1, maxLength: 10000 }, complaintChannel: { type: 'string', minLength: 1, maxLength: 5000 },
      postMarketPlan: { type: 'string', minLength: 1, maxLength: 10000 }, retentionUntil: { type: 'string', format: 'date' },
      evidenceDocumentIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
      notes: { type: 'string', maxLength: 5000 }
    }, additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/gpsr/technical-files/{technicalFileId}/reviews': {
    type: 'object', required: ['reviewerRole', 'decision', 'notes'], properties: {
      reviewerRole: { type: 'string', enum: ['product_safety_reviewer'] },
      decision: { type: 'string', enum: ['approved_for_internal_release', 'needs_information', 'rejected'] },
      notes: { type: 'string', minLength: 1, maxLength: 5000 }
    }, additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/gpsr/technical-files/{technicalFileId}/post-market-events': {
    type: 'object', required: ['eventType', 'eventReference', 'occurredAt', 'summary', 'severity'], properties: {
      eventType: { type: 'string', enum: ['complaint', 'safety_incident', 'corrective_action', 'recall', 'safety_business_gateway_notification', 'authority_request', 'consumer_notice'] },
      eventReference: { type: 'string', minLength: 1, maxLength: 200 }, occurredAt: { type: 'string', format: 'date-time' },
      summary: { type: 'string', minLength: 1, maxLength: 10000 }, severity: { type: 'string', enum: ['information', 'minor', 'serious', 'death', 'unknown'] },
      externalReference: { type: 'string', maxLength: 1000 }, evidenceDocumentId: { type: 'string', format: 'uuid' },
      consumerPersonalDataIncluded: { type: 'boolean', enum: [false] }, metadata: { type: 'object' }
    }, additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/environmental-claims': {
    type: 'object',
    required: [
      'claimReference', 'exactClaimText', 'publicCommunication', 'channel', 'marketCodes',
      'languageCode', 'communicationStart', 'subjectType', 'subjectReference', 'scopeStatement',
      'claimKind', 'specificationText', 'methodology', 'uncertaintyStatement',
      'updateTriggers', 'withdrawalTriggers', 'evidenceDocumentIds'
    ],
    properties: {
      claimReference: { type: 'string', minLength: 1, maxLength: 120 },
      exactClaimText: { type: 'string', minLength: 1, maxLength: 5000 },
      publicCommunication: { type: 'boolean' },
      channel: { type: 'string', enum: ['website', 'product_label', 'marketplace', 'advertising', 'sales_material', 'report', 'other'] },
      marketCodes: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z]{2}$' } },
      languageCode: { type: 'string', minLength: 2, maxLength: 35 },
      communicationStart: { type: 'string', format: 'date' },
      communicationEnd: { type: 'string', format: 'date', nullable: true },
      subjectType: { type: 'string', enum: ['product', 'sku', 'batch', 'shipment', 'brand', 'company'] },
      subjectReference: { type: 'string', minLength: 1, maxLength: 500 },
      scopeStatement: { type: 'string', minLength: 1, maxLength: 5000 },
      claimKind: { type: 'string', enum: ['generic_environmental', 'specific_environmental', 'comparative', 'future_performance', 'sustainability_label', 'offset_based_product_climate', 'legal_requirement_feature', 'other'] },
      specificationText: { type: 'string', maxLength: 5000 },
      claimScopeMode: { type: 'string', enum: ['entire_subject', 'specific_aspect'] },
      actualCoverage: { type: 'string', enum: ['entire_subject', 'aspect_only'] },
      recognizedExcellentPerformance: { type: 'boolean' },
      methodology: {
        type: 'object',
        properties: {
          standard: { type: 'string', maxLength: 500 }, version: { type: 'string', maxLength: 200 },
          pcr: { type: 'string', maxLength: 500 }, calculationSha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
          datasetReferences: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
          factorReferences: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } }
        },
        additionalProperties: false
      },
      comparison: {
        type: 'object', properties: {
          baseline: { type: 'string', maxLength: 2000 }, comparator: { type: 'string', maxLength: 2000 },
          sameMethodAndScope: { type: 'boolean' }
        }, additionalProperties: false
      },
      futureCommitment: {
        type: 'object', properties: {
          implementationPlanUrl: { type: 'string', maxLength: 2000 },
          milestones: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
          independentMonitoring: { type: 'boolean' }
        }, additionalProperties: false
      },
      labelScheme: {
        type: 'object', properties: {
          schemeType: { type: 'string', enum: ['certification_scheme', 'public_authority', 'self_declared', 'other'] },
          schemeName: { type: 'string', maxLength: 500 }, publicCriteriaUrl: { type: 'string', maxLength: 2000 }
        }, additionalProperties: false
      },
      limitations: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
      exclusions: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
      uncertaintyStatement: { type: 'string', maxLength: 5000 },
      qualifiers: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 1000 } },
      updateTriggers: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', maxLength: 1000 } },
      withdrawalTriggers: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', maxLength: 1000 } },
      assuranceReference: { type: 'string', maxLength: 1000 },
      evidenceDocumentIds: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
      notes: { type: 'string', maxLength: 5000 }
    },
    additionalProperties: false
  },
  'POST /export/shipments/{shipmentId}/environmental-claims/{dossierId}/reviews': {
    type: 'object', required: ['reviewerRole', 'decision', 'notes'],
    properties: {
      reviewerRole: { type: 'string', enum: ['legal_claim_reviewer'] },
      decision: { type: 'string', enum: ['approved_for_publication', 'needs_information', 'rejected', 'withdrawn'] },
      notes: { type: 'string', minLength: 1, maxLength: 5000 }
    },
    additionalProperties: false
  },
  'POST /carbon-calculations': {
    type: 'object',
    required: ['calculation_type', 'carbon_input'],
    properties: {
      calculation_type: {
        type: 'string',
        enum: ['product', 'shipment', 'facility', 'annual', 'other']
      },
      product_id: { type: 'string', format: 'uuid', nullable: true },
      shipment_id: { type: 'string', format: 'uuid', nullable: true },
      period_start: { type: 'string', format: 'date', nullable: true },
      period_end: { type: 'string', format: 'date', nullable: true },
      carbon_input: CARBON_ENGINE_INPUT_SCHEMA,
      notes: { type: 'string', nullable: true }
    },
    additionalProperties: false
  },
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
      GpsrEconomicOperator: {
        type: 'object',
        required: ['name', 'postalAddress', 'electronicAddress', 'euEstablished'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 500 },
          tradeName: { type: 'string', maxLength: 500 },
          postalAddress: { type: 'string', minLength: 1, maxLength: 2000 },
          electronicAddress: { type: 'string', minLength: 1, maxLength: 1000 },
          contactPoint: { type: 'string', maxLength: 1000 },
          euEstablished: { type: 'boolean' }
        },
        additionalProperties: false
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
          carbonAuthority: { $ref: '#/components/schemas/CarbonAuthorityReference' },
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
      CarbonAuthorityReference: {
        type: 'object',
        required: [
          'authoritative',
          'source',
          'calculationId',
          'calculationVersion',
          'calculatedAt',
          'engineVersion',
          'methodologyVersion',
          'factorRegistryVersion',
          'gwpBasis',
          'canonicalInputHash',
          'legacy'
        ],
        properties: {
          authoritative: { type: 'boolean', enum: [true] },
          source: { type: 'string', enum: ['product_assessment_snapshot'] },
          calculationId: { type: 'string', format: 'uuid' },
          calculationVersion: { type: 'integer', minimum: 1 },
          calculatedAt: { type: 'string', format: 'date-time', nullable: true },
          engineVersion: { type: 'string', minLength: 1 },
          methodologyVersion: { type: 'string', minLength: 1 },
          factorRegistryVersion: { type: 'string', minLength: 1 },
          gwpBasis: { type: 'string', minLength: 1 },
          canonicalInputHash: { type: 'string', minLength: 1 },
          legacy: { type: 'boolean' }
        },
        additionalProperties: false
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
          description: 'Application process is alive',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenericSuccessResponse' },
              example: {
                success: true,
                data: {
                  status: 'healthy',
                  timestamp: '2026-08-28T00:00:00.000Z',
                  uptime: 120
                }
              }
            }
          }
        }
      }
    }
  };

  spec.paths['/ready'] = {
    get: {
      tags: ['Health'], summary: 'Database and worker readiness', operationId: 'getReadiness',
      servers: [{ url: '/' }], security: [],
      responses: {
        200: { description: 'Dependencies are ready', content: { 'application/json': {
          schema: { $ref: '#/components/schemas/GenericSuccessResponse' }
        } } },
        503: { description: 'A dependency is unavailable', content: { 'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' }
        } } }
      }
    }
  };

  spec.paths['/metrics'] = {
    get: {
      tags: ['Health'], summary: 'Prometheus metrics', operationId: 'getMetrics',
      servers: [{ url: '/' }], security: [],
      responses: { 200: { description: 'Prometheus text exposition', content: {
        'text/plain': { schema: { type: 'string' } }
      } } }
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
