const dashboardService = require('./dashboardService');
const logger = require('../utils/logger');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const addDays = (days) => new Date(Date.now() + days * MS_PER_DAY);
const dateOnly = (days) => addDays(days).toISOString().slice(0, 10);
const isoAt = (days, hour = 8) => {
  const date = addDays(days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

const toJson = (value) => JSON.stringify(value || {});

const DEMO_PRODUCTS = [
  {
    sku: 'DEMO-B2B-TEE-001',
    name: 'Organic Cotton Tee',
    category: 'tshirt',
    weightKg: 0.18,
    quantity: 1200,
    status: 'active',
    confidence: 88,
    co2e: { materials: 1.62, production: 0.38, transport: 0.05, packaging: 0.04 },
    origin: { city: 'Bien Hoa', country: 'Vietnam', address: 'Tan Hiep Industrial Zone', lat: 10.95, lng: 106.85 },
    destination: { city: 'Ho Chi Minh City', country: 'Vietnam', address: 'District 7 DC', lat: 10.72, lng: 106.72 },
    materials: [{ materialType: 'organic_cotton', percentage: 100, source: 'domestic', certifications: ['gots'] }],
    processes: ['cutting_sewing', 'finishing'],
    energySources: [{ source: 'solar', percentage: 100 }]
  },
  {
    sku: 'DEMO-B2B-DEN-002',
    name: 'Recycled Denim Jeans',
    category: 'pants',
    weightKg: 0.42,
    quantity: 640,
    status: 'active',
    confidence: 82,
    co2e: { materials: 3.1, production: 0.95, transport: 0.42, packaging: 0.08 },
    origin: { city: 'Nam Dinh', country: 'Vietnam', address: 'Hoa Xa Industrial Park', lat: 20.42, lng: 106.17 },
    destination: { city: 'Rotterdam', country: 'Netherlands', address: 'Port of Rotterdam', lat: 51.95, lng: 4.14 },
    materials: [
      { materialType: 'cotton', percentage: 75, source: 'domestic', certifications: ['bci'] },
      { materialType: 'recycled_polyester', percentage: 25, source: 'imported', certifications: ['grs'] }
    ],
    processes: ['weaving', 'dyeing', 'cutting_sewing'],
    energySources: [{ source: 'grid', percentage: 70 }, { source: 'solar', percentage: 30 }]
  },
  {
    sku: 'DEMO-B2B-BAG-003',
    name: 'Hemp Canvas Tote',
    category: 'bag',
    weightKg: 0.31,
    quantity: 900,
    status: 'active',
    confidence: 79,
    co2e: { materials: 1.05, production: 0.44, transport: 0.28, packaging: 0.06 },
    origin: { city: 'Da Nang', country: 'Vietnam', address: 'Hoa Khanh Industrial Zone', lat: 16.07, lng: 108.15 },
    destination: { city: 'Los Angeles', country: 'United States', address: 'Port of Los Angeles', lat: 33.74, lng: -118.26 },
    materials: [{ materialType: 'hemp', percentage: 100, source: 'domestic', certifications: ['fsc'] }],
    processes: ['weaving', 'cutting_sewing', 'printing'],
    energySources: [{ source: 'mixed', percentage: 100 }]
  },
  {
    sku: 'DEMO-B2B-JKT-004',
    name: 'Recycled Performance Jacket',
    category: 'jacket',
    weightKg: 0.54,
    quantity: 300,
    status: 'draft',
    confidence: 61,
    co2e: { materials: 4.2, production: 1.3, transport: 3.4, packaging: 0.14 },
    origin: { city: 'Binh Duong', country: 'Vietnam', address: 'VSIP I', lat: 10.93, lng: 106.71 },
    destination: { city: 'New York', country: 'United States', address: 'JFK Cargo Terminal', lat: 40.64, lng: -73.78 },
    materials: [{ materialType: 'recycled_polyester', percentage: 100, source: 'imported', certifications: ['grs', 'rcs'] }],
    processes: ['cutting_sewing', 'finishing'],
    energySources: [{ source: 'grid', percentage: 100 }]
  }
];

const DEMO_SHIPMENTS = [
  {
    ref: 'DEMO-B2B-EU-001',
    status: 'in_transit',
    productSkus: ['DEMO-B2B-DEN-002'],
    origin: { country: 'Vietnam', city: 'Nam Dinh', address: 'Hoa Xa Industrial Park', lat: 20.42, lng: 106.17 },
    destination: { country: 'Netherlands', city: 'Rotterdam', address: 'Port of Rotterdam', lat: 51.95, lng: 4.14 },
    legs: [
      { mode: 'road', origin: 'Nam Dinh Factory', destination: 'Hai Phong Port', distance: 124, co2e: 18.5, factor: 0.12226, carrier: 'VietTrans Logistics', vehicle: 'Truck 16t' },
      { mode: 'sea', origin: 'Hai Phong Port', destination: 'Rotterdam Port', distance: 11870, co2e: 402.2, factor: 0.01612, carrier: 'Ocean Network Express', vehicle: 'Container vessel' }
    ],
    createdDaysAgo: -9,
    etaDays: 8
  },
  {
    ref: 'DEMO-B2B-US-002',
    status: 'pending',
    productSkus: ['DEMO-B2B-BAG-003'],
    origin: { country: 'Vietnam', city: 'Da Nang', address: 'Hoa Khanh Industrial Zone', lat: 16.07, lng: 108.15 },
    destination: { country: 'United States', city: 'Los Angeles', address: 'Port of Los Angeles', lat: 33.74, lng: -118.26 },
    legs: [
      { mode: 'road', origin: 'Da Nang Factory', destination: 'Da Nang Port', distance: 18, co2e: 4.2, factor: 0.12226, carrier: 'Central Freight', vehicle: 'Light truck' },
      { mode: 'sea', origin: 'Da Nang Port', destination: 'Los Angeles Port', distance: 13280, co2e: 252.1, factor: 0.01612, carrier: 'Maersk', vehicle: 'Container vessel' }
    ],
    createdDaysAgo: -2,
    etaDays: 18
  },
  {
    ref: 'DEMO-B2B-VN-003',
    status: 'delivered',
    productSkus: ['DEMO-B2B-TEE-001'],
    origin: { country: 'Vietnam', city: 'Bien Hoa', address: 'Tan Hiep Industrial Zone', lat: 10.95, lng: 106.85 },
    destination: { country: 'Vietnam', city: 'Ho Chi Minh City', address: 'District 7 DC', lat: 10.72, lng: 106.72 },
    legs: [
      { mode: 'road', origin: 'Bien Hoa Factory', destination: 'District 7 DC', distance: 45, co2e: 60, factor: 0.089, carrier: 'Saigon Distribution', vehicle: 'EV truck' }
    ],
    createdDaysAgo: -6,
    etaDays: -4,
    actualDays: -4
  }
];

const marketNameByCode = {
  VN: 'Vietnam',
  EU: 'European Union',
  US: 'United States'
};

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.name);
}

function buildProductSnapshot(product, shipmentId = null) {
  const perProduct = {
    ...product.co2e,
    energy: Number((product.co2e.production * 0.35).toFixed(4)),
    total: Number(Object.values(product.co2e).reduce((sum, value) => sum + value, 0).toFixed(4))
  };

  return {
    productCode: product.sku,
    productName: product.name,
    productType: product.category,
    weightPerUnit: Math.round(product.weightKg * 1000),
    quantity: product.quantity,
    materials: product.materials,
    productionProcesses: product.processes,
    energySources: product.energySources,
    originAddress: product.origin,
    destinationAddress: product.destination,
    destinationMarket: product.destination.country === 'Vietnam' ? 'vietnam' : 'export',
    shipmentId,
    carbonResults: {
      perProduct,
      totalBatch: Object.fromEntries(
        Object.entries(perProduct).map(([key, value]) => [key, Number((value * product.quantity).toFixed(4))])
      ),
      confidenceLevel: product.confidence >= 85 ? 'high' : product.confidence >= 65 ? 'medium' : 'low',
      confidenceScore: product.confidence,
      proxyUsed: product.confidence < 70,
      proxyNotes: product.confidence < 70 ? ['Demo supplier data still pending.'] : [],
      scope1: Number((perProduct.production * 0.35).toFixed(4)),
      scope2: Number((perProduct.production * 0.25).toFixed(4)),
      scope3: Number((perProduct.materials + perProduct.transport + perProduct.packaging).toFixed(4))
    }
  };
}

async function upsertProducts(client, companyId) {
  const productsBySku = new Map();

  for (let index = 0; index < DEMO_PRODUCTS.length; index += 1) {
    const product = DEMO_PRODUCTS[index];
    const totalCo2e = Object.values(product.co2e).reduce((sum, value) => sum + value, 0);
    const createdAt = isoAt(-20 + index, 3);
    const updatedAt = isoAt(-3 + Math.min(index, 2), 8);
    const result = await client.query(
      `
        INSERT INTO products (
          company_id, sku, name, category, weight_kg, status,
          total_co2e, materials_co2e, production_co2e, transport_co2e,
          packaging_co2e, data_confidence_score, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (company_id, sku)
        DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          weight_kg = EXCLUDED.weight_kg,
          status = EXCLUDED.status,
          total_co2e = EXCLUDED.total_co2e,
          materials_co2e = EXCLUDED.materials_co2e,
          production_co2e = EXCLUDED.production_co2e,
          transport_co2e = EXCLUDED.transport_co2e,
          packaging_co2e = EXCLUDED.packaging_co2e,
          data_confidence_score = EXCLUDED.data_confidence_score,
          updated_at = EXCLUDED.updated_at
        RETURNING id, sku
      `,
      [
        companyId,
        product.sku,
        product.name,
        product.category,
        product.weightKg,
        product.status,
        totalCo2e,
        product.co2e.materials,
        product.co2e.production,
        product.co2e.transport,
        product.co2e.packaging,
        product.confidence,
        createdAt,
        updatedAt
      ]
    );

    productsBySku.set(product.sku, result.rows[0].id);

    await client.query(
      `
        INSERT INTO product_assessment_snapshots (product_id, version, payload, created_at, updated_at)
        VALUES ($1, 1, $2::jsonb, $3, $4)
        ON CONFLICT (product_id)
        DO UPDATE SET payload = EXCLUDED.payload, version = 1, updated_at = EXCLUDED.updated_at
      `,
      [result.rows[0].id, toJson(buildProductSnapshot(product)), createdAt, updatedAt]
    );
  }

  return productsBySku;
}

async function upsertShipment(client, companyId, shipment, productsBySku) {
  const productIds = shipment.productSkus.map((sku) => productsBySku.get(sku)).filter(Boolean);
  const totalDistance = shipment.legs.reduce((sum, leg) => sum + leg.distance, 0);
  const totalCo2e = shipment.legs.reduce((sum, leg) => sum + leg.co2e, 0);
  const linkedProducts = DEMO_PRODUCTS.filter((product) => productIds.includes(productsBySku.get(product.sku)));
  const totalWeight = linkedProducts.reduce(
    (sum, product) => sum + product.weightKg * product.quantity,
    0
  );
  const existing = await client.query(
    'SELECT id FROM shipments WHERE company_id = $1 AND reference_number = $2 ORDER BY created_at DESC LIMIT 1',
    [companyId, shipment.ref]
  );
  const createdAt = isoAt(shipment.createdDaysAgo, 2);
  const updatedAt = isoAt(Math.min(shipment.createdDaysAgo + 2, -1), 5);

  let shipmentId = existing.rows[0]?.id;
  if (shipmentId) {
    await client.query(
      `
        UPDATE shipments
        SET status = $3,
            origin_country = $4,
            origin_city = $5,
            origin_address = $6,
            origin_lat = $7,
            origin_lng = $8,
            destination_country = $9,
            destination_city = $10,
            destination_address = $11,
            destination_lat = $12,
            destination_lng = $13,
            total_weight_kg = $14,
            total_distance_km = $15,
            total_co2e = $16,
            estimated_arrival = $17,
            estimated_arrival_at = $18,
            actual_arrival = $19,
            actual_arrival_at = $20,
            simulation_enabled = false,
            updated_at = $21
        WHERE id = $1 AND company_id = $2
      `,
      [
        shipmentId,
        companyId,
        shipment.status,
        shipment.origin.country,
        shipment.origin.city,
        shipment.origin.address,
        shipment.origin.lat,
        shipment.origin.lng,
        shipment.destination.country,
        shipment.destination.city,
        shipment.destination.address,
        shipment.destination.lat,
        shipment.destination.lng,
        totalWeight,
        totalDistance,
        totalCo2e,
        dateOnly(shipment.etaDays),
        isoAt(shipment.etaDays, 10),
        shipment.actualDays == null ? null : dateOnly(shipment.actualDays),
        shipment.actualDays == null ? null : isoAt(shipment.actualDays, 11),
        updatedAt
      ]
    );
  } else {
    const result = await client.query(
      `
        INSERT INTO shipments (
          company_id, reference_number, status, origin_country, origin_city,
          origin_address, origin_lat, origin_lng, destination_country,
          destination_city, destination_address, destination_lat, destination_lng,
          total_weight_kg, total_distance_km, total_co2e, estimated_arrival,
          estimated_arrival_at, actual_arrival, actual_arrival_at,
          simulation_enabled, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false,$21,$22)
        RETURNING id
      `,
      [
        companyId,
        shipment.ref,
        shipment.status,
        shipment.origin.country,
        shipment.origin.city,
        shipment.origin.address,
        shipment.origin.lat,
        shipment.origin.lng,
        shipment.destination.country,
        shipment.destination.city,
        shipment.destination.address,
        shipment.destination.lat,
        shipment.destination.lng,
        totalWeight,
        totalDistance,
        totalCo2e,
        dateOnly(shipment.etaDays),
        isoAt(shipment.etaDays, 10),
        shipment.actualDays == null ? null : dateOnly(shipment.actualDays),
        shipment.actualDays == null ? null : isoAt(shipment.actualDays, 11),
        createdAt,
        updatedAt
      ]
    );
    shipmentId = result.rows[0].id;
  }

  await client.query('DELETE FROM shipment_legs WHERE shipment_id = $1', [shipmentId]);
  await client.query('DELETE FROM shipment_products WHERE shipment_id = $1', [shipmentId]);

  for (let index = 0; index < shipment.legs.length; index += 1) {
    const leg = shipment.legs[index];
    await client.query(
      `
        INSERT INTO shipment_legs (
          shipment_id, leg_order, transport_mode, origin_location,
          destination_location, distance_km, duration_hours, co2e,
          emission_factor_used, carrier_name, vehicle_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        shipmentId,
        index + 1,
        leg.mode,
        leg.origin,
        leg.destination,
        leg.distance,
        Math.max(1, Math.round(leg.distance / (leg.mode === 'sea' ? 30 : 45))),
        leg.co2e,
        leg.factor,
        leg.carrier,
        leg.vehicle
      ]
    );
  }

  for (const product of linkedProducts) {
    await client.query(
      `
        INSERT INTO shipment_products (shipment_id, product_id, quantity, weight_kg, allocated_co2e)
        VALUES ($1,$2,$3,$4,$5)
      `,
      [
        shipmentId,
        productsBySku.get(product.sku),
        product.quantity,
        Number((product.weightKg * product.quantity).toFixed(4)),
        Number((product.co2e.transport * product.quantity).toFixed(4))
      ]
    );

    await client.query(
      `
        UPDATE product_assessment_snapshots
        SET payload = $2::jsonb, updated_at = now()
        WHERE product_id = $1
      `,
      [productsBySku.get(product.sku), toJson(buildProductSnapshot(product, shipmentId))]
    );
  }

  return shipmentId;
}

async function upsertOptionalRows(client, companyId, userId, productsBySku) {
  if (await tableExists(client, 'supplier_requests')) {
    const suppliers = [
      ['Viet Thang Textile Co.', 'scope3@vietthang.example', 'Organic cotton yarn', ['energy_mix', 'material_origin'], dateOnly(7), 'waiting'],
      ['Ocean Network Express', 'docs@one.example', 'Sea freight data', ['bill_of_lading', 'fuel_factor'], dateOnly(3), 'sent'],
      ['Green Dye House', 'audit@greendye.example', 'Dyeing process data', ['water_usage', 'chemical_inventory'], dateOnly(-1), 'overdue']
    ];
    for (const supplier of suppliers) {
      const existing = await client.query(
        'SELECT id FROM supplier_requests WHERE company_id = $1 AND supplier_email = $2 LIMIT 1',
        [companyId, supplier[1]]
      );
      if (existing.rows[0]) {
        await client.query(
          `
            UPDATE supplier_requests
            SET supplier_name = $3, material_supplied = $4, required_data = $5,
                deadline = $6, status = $7, sent_at = COALESCE(sent_at, $8), updated_at = now()
            WHERE id = $1 AND company_id = $2
          `,
          [existing.rows[0].id, companyId, supplier[0], supplier[2], supplier[3], supplier[4], supplier[5], isoAt(-2)]
        );
      } else {
        await client.query(
          `
            INSERT INTO supplier_requests (
              company_id, supplier_name, supplier_email, material_supplied,
              required_data, deadline, status, sent_at, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
          `,
          [companyId, supplier[0], supplier[1], supplier[2], supplier[3], supplier[4], supplier[5], isoAt(-2), isoAt(-5)]
        );
      }
    }
  }

  if (await tableExists(client, 'data_gaps')) {
    const gaps = [
      ['Supplier Scope 3 energy mix', 'missing', 'high', 'Request monthly kWh split from top fabric suppliers.', 'Supply Chain', dateOnly(7)],
      ['GRS certificate expiry tracking', 'uploaded', 'medium', 'Review uploaded certificate before next export batch.', 'Compliance', dateOnly(14)],
      ['Transport bill of lading OCR', 'proxy', 'medium', 'Replace proxy distance with carrier document extraction.', 'Logistics', dateOnly(3)]
    ];
    for (const gap of gaps) {
      const existing = await client.query(
        'SELECT id FROM data_gaps WHERE company_id = $1 AND data_group = $2 LIMIT 1',
        [companyId, gap[0]]
      );
      if (existing.rows[0]) {
        await client.query(
          `
            UPDATE data_gaps
            SET current_status = $3, risk_level = $4, required_action = $5,
                owner = $6, deadline = $7, updated_at = now()
            WHERE id = $1 AND company_id = $2
          `,
          [existing.rows[0].id, companyId, gap[1], gap[2], gap[3], gap[4], gap[5]]
        );
      } else {
        await client.query(
          `
            INSERT INTO data_gaps (
              company_id, data_group, required_for_audit, current_status,
              risk_level, required_action, owner, deadline, created_at, updated_at
            ) VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$8)
          `,
          [companyId, gap[0], gap[1], gap[2], gap[3], gap[4], gap[5], isoAt(-4)]
        );
      }
    }
  }

  if (await tableExists(client, 'audit_trail')) {
    await client.query(
      "DELETE FROM audit_trail WHERE company_id = $1 AND reason = 'demo.seed'",
      [companyId]
    );
    const auditRows = [
      ['products', 'seeded', null, '4 demo SKUs', 'Demo B2B product catalog seeded'],
      ['logistics', 'shipment_status', 'pending', 'in_transit', 'Demo EU shipment moved to in transit'],
      ['evidence', 'document_status', 'uploaded', 'locked', 'Demo electricity invoice verified'],
      ['reports', 'status', 'processing', 'completed', 'Demo carbon audit report generated']
    ];
    for (let index = 0; index < auditRows.length; index += 1) {
      const row = auditRows[index];
      await client.query(
        `
          INSERT INTO audit_trail (
            company_id, data_group, changed_field, old_value, new_value,
            reason, notes, changed_by, created_at
          ) VALUES ($1,$2,$3,$4,$5,'demo.seed',$6,$7,$8)
        `,
        [companyId, row[0], row[1], row[2], row[3], row[4], userId, isoAt(-3 + index, 9)]
      );
    }
  }

  if (await tableExists(client, 'evidence_documents')) {
    const productId = productsBySku.get('DEMO-B2B-TEE-001');
    const existing = await client.query(
      'SELECT id FROM evidence_documents WHERE company_id = $1 AND lookup_code = $2 LIMIT 1',
      [companyId, 'DEMO-EVN-2026']
    );
    if (existing.rows[0]) {
      await client.query(
        `
          UPDATE evidence_documents
          SET product_id = $3, status = 'locked', source_vendor = 'EVN HCMC',
              reporting_period_start = $4, reporting_period_end = $5,
              extracted_json = $6::jsonb, locked_at = COALESCE(locked_at, $7),
              locked_by = COALESCE(locked_by, $8), updated_at = now()
          WHERE id = $1 AND company_id = $2
        `,
        [
          existing.rows[0].id,
          companyId,
          productId,
          dateOnly(-35),
          dateOnly(-5),
          toJson({ supplier: 'EVN HCMC', kwh_total: 48200, amount_vnd: 96400000 }),
          isoAt(-2),
          userId
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO evidence_documents (
            company_id, product_id, evidence_type, document_name, lookup_code,
            source_vendor, reporting_period_start, reporting_period_end,
            storage_provider, storage_key, original_filename, mime_type,
            file_size_bytes, extracted_json, status, locked_at, locked_by,
            uploaded_by, uploaded_at, created_at, updated_at
          ) VALUES ($1,$2,'electricity_bill','EVN-Invoice-Demo.pdf','DEMO-EVN-2026',$3,$4,$5,
                    'local','demo/evn-invoice.pdf','EVN-Invoice-Demo.pdf','application/pdf',
                    24576,$6::jsonb,'locked',$7,$8,$8,$9,$9,$9)
        `,
        [
          companyId,
          productId,
          'EVN HCMC',
          dateOnly(-35),
          dateOnly(-5),
          toJson({ supplier: 'EVN HCMC', kwh_total: 48200, amount_vnd: 96400000 }),
          isoAt(-2),
          userId,
          isoAt(-3)
        ]
      );
    }
  }
}

async function upsertReportsAndMetrics(client, companyId, userId) {
  const current = new Date();
  for (let index = 5; index >= 0; index -= 1) {
    const monthDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - index, 1));
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    const actual = 920 + (5 - index) * 65;
    await client.query(
      `
        INSERT INTO carbon_targets (
          company_id, year, month, target_co2e, actual_co2e, reduction_percentage, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,8,now(),now())
        ON CONFLICT (company_id, year, month)
        DO UPDATE SET target_co2e = EXCLUDED.target_co2e,
                      actual_co2e = EXCLUDED.actual_co2e,
                      reduction_percentage = EXCLUDED.reduction_percentage,
                      updated_at = now()
      `,
      [companyId, year, month, Number((actual * 0.92).toFixed(2)), actual]
    );
  }

  const reports = [
    ['Carbon audit snapshot', 'carbon_audit', 'xlsx', 4, 24600],
    ['EU export readiness pack', 'compliance', 'pdf', 3, 18400],
    ['Product dataset export', 'dataset_export', 'csv', 4, 6800]
  ];
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    const existing = await client.query(
      'SELECT id FROM reports WHERE company_id = $1 AND title = $2 LIMIT 1',
      [companyId, report[0]]
    );
    const values = [
      companyId,
      report[1],
      report[0],
      'Auto-seeded demo report',
      dateOnly(-30),
      dateOnly(0),
      report[1] === 'compliance' ? 'EU' : null,
      report[1] === 'dataset_export' ? 'product' : null,
      'completed',
      report[2],
      report[3],
      report[4],
      `demo/reports/${report[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${report[2]}`,
      `${report[0]}.${report[2]}`,
      null,
      userId,
      isoAt(-2 + index, 8)
    ];
    if (existing.rows[0]) {
      await client.query(
        `
          UPDATE reports
          SET report_type = $2, description = $4, period_start = $5, period_end = $6,
              target_market = $7, dataset_type = $8, status = $9, file_format = $10,
              records = $11, file_size_bytes = $12, storage_provider = 'local',
              storage_key = $13, original_filename = $14, download_url = $15,
              created_by = COALESCE(created_by, $16), generated_at = $17, updated_at = now()
          WHERE id = $1 AND company_id = $18
        `,
        [existing.rows[0].id, ...values.slice(1), companyId]
      );
    } else {
      await client.query(
        `
          INSERT INTO reports (
            company_id, report_type, title, description, period_start, period_end,
            target_market, dataset_type, status, file_format, records, file_size_bytes,
            storage_provider, storage_key, original_filename, download_url,
            created_by, generated_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'local',$13,$14,$15,$16,$17,$17,$17)
        `,
        values
      );
    }
  }
}

async function upsertExportReadiness(client, companyId, userId, productsBySku) {
  for (const [marketCode, score, status] of [
    ['VN', 78, 'ready'],
    ['EU', 72, 'ready'],
    ['US', 58, 'incomplete']
  ]) {
    const marketResult = await client.query(
      `
        INSERT INTO export_markets (
          company_id, market_code, market_name, status, score,
          verification_status, verification_date, verification_body, verification_notes,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'pending',$6,'Demo verifier','Seeded demo readiness',now(),now())
        ON CONFLICT (company_id, market_code)
        DO UPDATE SET market_name = EXCLUDED.market_name,
                      status = EXCLUDED.status,
                      score = EXCLUDED.score,
                      verification_status = EXCLUDED.verification_status,
                      verification_date = EXCLUDED.verification_date,
                      verification_body = EXCLUDED.verification_body,
                      verification_notes = EXCLUDED.verification_notes,
                      updated_at = now()
        RETURNING id
      `,
      [companyId, marketCode, marketNameByCode[marketCode], status, score, isoAt(-2)]
    );

    await client.query(
      `
        INSERT INTO market_readiness (
          company_id, market_code, market_name, readiness_score, status,
          requirements_met, requirements_missing, last_assessed_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())
        ON CONFLICT (company_id, market_code)
        DO UPDATE SET market_name = EXCLUDED.market_name,
                      readiness_score = EXCLUDED.readiness_score,
                      status = EXCLUDED.status,
                      requirements_met = EXCLUDED.requirements_met,
                      requirements_missing = EXCLUDED.requirements_missing,
                      last_assessed_at = now(),
                      updated_at = now()
      `,
      [
        companyId,
        marketCode,
        marketNameByCode[marketCode],
        score,
        status,
        ['carbon_footprint_report', 'product_traceability'],
        marketCode === 'US' ? ['country_of_origin_marking'] : ['third_party_verification']
      ]
    );

    const marketId = marketResult.rows[0].id;
    for (const scope of ['scope1', 'scope2', 'scope3']) {
      await client.query(
        `
          INSERT INTO market_carbon_data (
            market_id, scope, value, unit, methodology, data_source, reporting_period, created_at, updated_at
          ) VALUES ($1,$2,$3,'tCO2e','GHG Protocol','Demo seed data',$4,now(),now())
          ON CONFLICT (market_id, scope)
          DO UPDATE SET value = EXCLUDED.value,
                        methodology = EXCLUDED.methodology,
                        data_source = EXCLUDED.data_source,
                        reporting_period = EXCLUDED.reporting_period,
                        updated_at = now()
        `,
        [marketId, scope, scope === 'scope3' ? 166.9 : scope === 'scope2' ? 31.1 : 48.4, String(new Date().getUTCFullYear())]
      );
    }

    const scopedProductId = productsBySku.get(marketCode === 'US' ? 'DEMO-B2B-BAG-003' : 'DEMO-B2B-DEN-002');
    if (scopedProductId) {
      await client.query(
        `
          INSERT INTO market_product_scope (market_id, product_id, hs_code, notes, created_at, updated_at)
          VALUES ($1,$2,$3,$4,now(),now())
          ON CONFLICT (market_id, product_id)
          DO UPDATE SET hs_code = EXCLUDED.hs_code, notes = EXCLUDED.notes, updated_at = now()
        `,
        [marketId, scopedProductId, marketCode === 'US' ? '420292' : '620342', toJson({ production_site: 'Demo Factory', export_volume: 640, unit: 'pcs' })]
      );
    }

    await client.query(
      'DELETE FROM market_recommendations WHERE market_id = $1 AND missing_item = $2',
      [marketId, marketCode === 'US' ? 'Country-of-origin marking' : 'Third-party verification letter']
    );
    await client.query(
      `
        INSERT INTO market_recommendations (
          market_id, type, missing_item, regulatory_reason, impact_if_missing,
          priority, status, created_at, updated_at
        ) VALUES ($1,'document',$2,$3,$4,'important','active',now(),now())
      `,
      [
        marketId,
        marketCode === 'US' ? 'Country-of-origin marking' : 'Third-party verification letter',
        'Required before the shipment can be marked fully audit-ready.',
        'Export readiness score remains capped until this evidence is uploaded.'
      ]
    );
  }

  await client.query(
    `
      UPDATE companies
      SET name = 'WeaveCarbon Demo Factory',
          business_type = 'brand',
          current_plan = 'standard',
          domestic_market = 'VN',
          target_markets = ARRAY['EU','US']::text[],
          updated_at = now()
      WHERE id = $1
    `,
    [companyId]
  );

  await client.query(
    `
      DELETE FROM ai_recommendations
      WHERE company_id = $1
        AND recommendation_text = ANY($2::text[])
    `,
    [
      companyId,
      [
        'Switch denim finishing to renewable electricity for the next export batch.',
        'Consolidate US-bound tote shipments to reduce partial-container sea freight emissions.'
      ]
    ]
  );

  await client.query(
    `
      INSERT INTO ai_recommendations (
        company_id, product_id, recommendation_text, impact_level,
        estimated_reduction_percentage, estimated_cost_savings, category,
        is_implemented, created_at, updated_at
      ) VALUES
        ($1,$2,'Switch denim finishing to renewable electricity for the next export batch.','high',12,4200,'production',false,now(),now()),
        ($1,$3,'Consolidate US-bound tote shipments to reduce partial-container sea freight emissions.','medium',7,1800,'transport',false,now(),now())
    `,
    [companyId, productsBySku.get('DEMO-B2B-DEN-002') || null, productsBySku.get('DEMO-B2B-BAG-003') || null]
  );
}

async function seedDemoB2BData(client, companyId, userId) {
  const productsBySku = await upsertProducts(client, companyId);

  for (const shipment of DEMO_SHIPMENTS) {
    await upsertShipment(client, companyId, shipment, productsBySku);
  }

  await upsertReportsAndMetrics(client, companyId, userId);
  await upsertExportReadiness(client, companyId, userId, productsBySku);
  await upsertOptionalRows(client, companyId, userId, productsBySku);

  try {
    dashboardService.invalidateOverviewCache(companyId);
  } catch (error) {
    logger.warn({ err: error.message }, `[demoB2BSeeder] Could not invalidate overview cache for ${companyId}`);
  }

  return {
    products: DEMO_PRODUCTS.length,
    shipments: DEMO_SHIPMENTS.length,
    reports: 3
  };
}

module.exports = {
  seedDemoB2BData
};
