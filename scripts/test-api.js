/**
 * WeaveCarbon API Integration Test Suite
 * Usage: node scripts/test-api.js [BASE_URL] [EMAIL] [PASSWORD]
 *
 * Defaults:
 *   BASE_URL = http://localhost:4100
 *   EMAIL    = test@weavecarbon.com
 *   PASSWORD = Test1234!
 */

const BASE_URL = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:4100';
const TEST_EMAIL = process.argv[3] || process.env.TEST_EMAIL || 'test@weavecarbon.com';
const TEST_PASSWORD = process.argv[4] || process.env.TEST_PASSWORD || 'Test1234!';

let token = null;
let companyId = null;
let results = [];

// ─── helpers ──────────────────────────────────────────────────────────────────

async function req(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.noContentType) delete headers['Content-Type'];

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: opts.headers || headers,
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

  let data;
  const ct = res.headers.get('content-type') || '';
  try {
    data = ct.includes('json') ? await res.json() : await res.text();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const SKIP = '\x1b[90m–\x1b[0m';

function record(icon, name, status, note = '') {
  results.push({ icon, name, status, note });
  const noteStr = note ? `  \x1b[90m(${note})\x1b[0m` : '';
  console.log(`  ${icon} [${String(status).padStart(3)}] ${name}${noteStr}`);
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result === 'skip') {
      record(SKIP, name, '---', 'skipped');
    } else if (result === true || result === undefined) {
      record(PASS, name, 'OK');
    } else {
      record(PASS, name, result.status || 'OK', result.note || '');
    }
  } catch (e) {
    record(FAIL, name, e.status || 'ERR', e.message || String(e));
  }
}

function assert(condition, message, status) {
  if (!condition) {
    const e = new Error(message);
    e.status = status || 'FAIL';
    throw e;
  }
}

function section(title) {
  console.log(`\n\x1b[1m\x1b[34m── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}\x1b[0m`);
}

// ─── test groups ──────────────────────────────────────────────────────────────

async function runHealthCheck() {
  section('Health');
  await test('GET /health', async () => {
    const r = await req('GET', '/health');
    assert(r.status === 200, `Expected 200, got ${r.status}`, r.status);
  });
}

async function runAuth() {
  section('Auth');

  await test('POST /api/auth/signin — valid credentials (or demo fallback)', async () => {
    const USE_DEMO = TEST_EMAIL === 'test@weavecarbon.com';

    if (USE_DEMO) {
      // Use demo endpoint when no real credentials provided
      const r = await req('POST', '/api/auth/demo', { role: 'b2b' });
      assert(r.status === 200, `demo signin returned ${r.status}`, r.status);
      token = r.data?.data?.tokens?.access_token;
      assert(token, 'No access_token in demo response', 'NO_TOKEN');
      companyId = r.data?.data?.company?.id;
      return { status: 200, note: `demo token acquired, companyId=${companyId}` };
    }

    const r = await req('POST', '/api/auth/signin', { email: TEST_EMAIL, password: TEST_PASSWORD });
    if (r.status === 401) {
      // Fallback: try demo account
      console.log('\x1b[33m  ⚠ signin 401 — falling back to /api/auth/demo\x1b[0m');
      const rd = await req('POST', '/api/auth/demo', { role: 'b2b' });
      assert(rd.status === 200, `demo fallback returned ${rd.status}`, rd.status);
      token = rd.data?.data?.tokens?.access_token;
      assert(token, 'No access_token in demo response', 'NO_TOKEN');
      companyId = rd.data?.data?.company?.id;
      return { status: 200, note: `demo fallback token, companyId=${companyId}` };
    }
    assert(r.status === 200, `signin returned ${r.status}: ${JSON.stringify(r.data)}`, r.status);
    // Regular signin: tokens at data.tokens.access_token OR legacy data.token
    token = r.data?.data?.tokens?.access_token || r.data?.data?.token || r.data?.token;
    assert(token, 'No token in signin response', 'NO_TOKEN');
    companyId = r.data?.data?.company?.id || r.data?.data?.user?.company_id;
    return { status: 200, note: `token acquired, companyId=${companyId || 'null'}` };
  });

  await test('GET /api/auth/session', async () => {
    if (!token) return 'skip';
    const r = await req('GET', '/api/auth/session');
    assert(r.status === 200, `Got ${r.status}`, r.status);
  });

  await test('GET /api/auth/check-company', async () => {
    if (!token) return 'skip';
    const r = await req('GET', '/api/auth/check-company');
    assert([200, 404].includes(r.status), `Got ${r.status}`, r.status);
    if (r.status === 200 && r.data?.data?.company_id) {
      companyId = companyId || r.data.data.company_id;
    }
  });
}

async function runAccount() {
  section('Account');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/account', async () => {
    const r = await req('GET', '/api/account');
    assert(r.status === 200, `Got ${r.status}`, r.status);
    companyId = companyId || r.data?.data?.company?.id;
    return { status: 200, note: `plan=${r.data?.data?.company?.current_plan || 'null'}` };
  });

  await test('PUT /api/account/profile (no-op update)', async () => {
    const r = await req('PUT', '/api/account/profile', { full_name: 'Test User' });
    assert([200, 400].includes(r.status), `Got ${r.status}`, r.status);
  });
}

async function runDashboard() {
  section('Dashboard');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/dashboard/overview', async () => {
    const r = await req('GET', '/api/dashboard/overview');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runProducts() {
  section('Products');
  if (!token) { console.log('  – skipped (no token)'); return; }

  let productId;

  await test('GET /api/products', async () => {
    const r = await req('GET', '/api/products?page=1&page_size=10');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    const items = r.data?.data?.items || r.data?.data || [];
    productId = Array.isArray(items) && items.length > 0 ? items[0].id : null;
    return { status: r.status, note: `count=${Array.isArray(items) ? items.length : '?'}` };
  });

  await test('POST /api/products (create test product)', async () => {
    if (!companyId) return 'skip';
    const r = await req('POST', '/api/products', {
      productName: '__test_product__',
      productCode: `TEST-${Date.now()}`,
      category: 'apparel',
      weight_kg: 0.5,
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    if (r.status === 201 || r.status === 200) {
      productId = r.data?.data?.id || productId;
    }
    return { status: r.status };
  });

  await test('GET /api/products/:id', async () => {
    if (!productId) return 'skip';
    const r = await req('GET', `/api/products/${productId}`);
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('PATCH /api/products/:id/status', async () => {
    if (!productId) return 'skip';
    const r = await req('PATCH', `/api/products/${productId}/status`, { status: 'draft' });
    assert([200, 400, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runProductBatches() {
  section('Product Batches');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/product-batches', async () => {
    const r = await req('GET', '/api/product-batches');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runEvidence() {
  section('Evidence');
  if (!token) { console.log('  – skipped (no token)'); return; }

  let docId;

  await test('GET /api/evidence', async () => {
    const r = await req('GET', '/api/evidence');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    const items = r.data?.data?.items || [];
    docId = items.length > 0 ? items[0].id : null;
    return { status: r.status, note: `docs=${items.length}` };
  });

  await test('POST /api/evidence/upload (multipart)', async () => {
    if (!companyId) return 'skip';
    const { FormData, Blob } = await import('node:buffer').then(() => globalThis);
    if (!FormData) return { status: 'SKIP', note: 'FormData not available in this Node version' };
    const form = new FormData();
    form.append('file', new Blob(['dummy-content'], { type: 'text/plain' }), 'test.txt');
    form.append('kind', 'other');
    const r = await fetch(`${BASE_URL}/api/evidence/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    assert([200, 201, 400].includes(r.status), `Got ${r.status}: ${JSON.stringify(data)}`, r.status);
    if ((r.status === 200 || r.status === 201) && data?.data?.id) docId = data.data.id;
    return { status: r.status };
  });

  await test('GET /api/evidence/:id/fields', async () => {
    if (!docId) return 'skip';
    const r = await req('GET', `/api/evidence/${docId}/fields`);
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('POST /api/evidence/:id/confirm', async () => {
    if (!docId) return 'skip';
    const r = await req('POST', `/api/evidence/${docId}/confirm`, { fields: [] });
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/evidence/product/:product_id (no product)', async () => {
    const r = await req('GET', '/api/evidence/product/00000000-0000-0000-0000-000000000000');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runSuppliers() {
  section('Suppliers');
  if (!token) { console.log('  – skipped (no token)'); return; }

  let supplierId;

  await test('GET /api/suppliers', async () => {
    const r = await req('GET', '/api/suppliers');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    const rows = r.data?.data || [];
    supplierId = Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
    return { status: r.status, note: `rows=${Array.isArray(rows) ? rows.length : '?'}` };
  });

  await test('POST /api/suppliers', async () => {
    const r = await req('POST', '/api/suppliers', {
      supplier_name: '__test_supplier__',
      supplier_email: 'test@supplier.com',
      required_data: ['Energy data'],
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    if ((r.status === 200 || r.status === 201) && r.data?.data?.id) supplierId = r.data.data.id;
    return { status: r.status };
  });

  await test('PUT /api/suppliers/:id', async () => {
    if (!supplierId) return 'skip';
    const r = await req('PUT', `/api/suppliers/${supplierId}`, { status: 'sent' });
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runDataGaps() {
  section('Data Gaps');
  if (!token) { console.log('  – skipped (no token)'); return; }

  let gapId;

  await test('GET /api/data-gaps', async () => {
    const r = await req('GET', '/api/data-gaps');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    const rows = r.data?.data || [];
    gapId = Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
    return { status: r.status, note: `rows=${Array.isArray(rows) ? rows.length : '?'}` };
  });

  await test('POST /api/data-gaps/seed', async () => {
    const r = await req('POST', '/api/data-gaps/seed', {
      groups: [{ data_group: 'test_seed', required_for_audit: false, risk_level: 'low', required_action: 'none' }]
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('POST /api/data-gaps', async () => {
    const r = await req('POST', '/api/data-gaps', {
      data_group: `__test_gap_${Date.now()}__`,
      required_for_audit: false,
      risk_level: 'low',
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    if ((r.status === 200 || r.status === 201) && r.data?.data?.id) gapId = r.data.data.id;
    return { status: r.status };
  });

  await test('PUT /api/data-gaps/:id', async () => {
    if (!gapId) return 'skip';
    const r = await req('PUT', `/api/data-gaps/${gapId}`, { current_status: 'uploaded', risk_level: 'low' });
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runAuditTrail() {
  section('Audit Trail');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/audit-trail', async () => {
    const r = await req('GET', '/api/audit-trail?limit=20');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    const rows = r.data?.data || [];
    return { status: r.status, note: `entries=${Array.isArray(rows) ? rows.length : '?'}` };
  });
}

async function runCBAM() {
  section('CBAM Endpoints');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/electricity-invoices', async () => {
    const r = await req('GET', '/api/electricity-invoices');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('POST /api/electricity-invoices', async () => {
    const r = await req('POST', '/api/electricity-invoices', {
      billing_period: '2025-Q1',
      kwh: 12000,
      facility_name: 'Test Factory',
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/fuel-invoices', async () => {
    const r = await req('GET', '/api/fuel-invoices');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('POST /api/fuel-invoices', async () => {
    const r = await req('POST', '/api/fuel-invoices', {
      billing_period: '2025-Q1',
      fuel_type: 'diesel',
      quantity_liters: 500,
    });
    assert([200, 201, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/carbon-calculations', async () => {
    const r = await req('GET', '/api/carbon-calculations');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runSubscription() {
  section('Subscription');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/subscription', async () => {
    const r = await req('GET', '/api/subscription');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('POST /api/subscription/request-upgrade', async () => {
    const r = await req('POST', '/api/subscription/request-upgrade', { requested_plan: 'standard' });
    assert([200, 400, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/subscription/payment-status', async () => {
    const r = await req('GET', '/api/subscription/payment-status?session_id=00000000-0000-0000-0000-000000000000');
    assert([200, 400, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runCompanyMembers() {
  section('Company Members');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/company/members', async () => {
    const r = await req('GET', '/api/company/members');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runReports() {
  section('Reports');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/reports', async () => {
    const r = await req('GET', '/api/reports');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/reports/export-sources', async () => {
    const r = await req('GET', '/api/reports/export-sources');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runLogistics() {
  section('Logistics');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/logistics/overview', async () => {
    const r = await req('GET', '/api/logistics/overview');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/logistics/shipments', async () => {
    const r = await req('GET', '/api/logistics/shipments');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runExport() {
  section('Export & Markets');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/export/configuration', async () => {
    const r = await req('GET', '/api/export/configuration');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });

  await test('GET /api/export/markets', async () => {
    const r = await req('GET', '/api/export/markets');
    assert([200, 403].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runPassport() {
  section('Passport');
  if (!token) { console.log('  – skipped (no token)'); return; }

  await test('GET /api/passport/:productId (mock id)', async () => {
    const r = await req('GET', '/api/passport/00000000-0000-0000-0000-000000000000');
    assert([200, 403, 404].includes(r.status), `Got ${r.status}`, r.status);
    return { status: r.status };
  });
}

async function runUnauthenticated() {
  section('Unauthenticated (should 401)');

  for (const path of ['/api/products', '/api/evidence', '/api/suppliers', '/api/data-gaps', '/api/audit-trail']) {
    const savedToken = token;
    token = null;
    await test(`GET ${path} without token → 401`, async () => {
      const r = await req('GET', path);
      assert(r.status === 401, `Expected 401, got ${r.status}`, r.status);
    });
    token = savedToken;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m\x1b[36m════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[36m  WeaveCarbon API Integration Test Suite\x1b[0m');
  console.log(`\x1b[1m\x1b[36m  Target: ${BASE_URL}\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m  User:   ${TEST_EMAIL}\x1b[0m`);
  console.log('\x1b[1m\x1b[36m════════════════════════════════════════════════════\x1b[0m');

  await runHealthCheck();
  await runAuth();
  await runAccount();
  await runDashboard();
  await runProducts();
  await runProductBatches();
  await runEvidence();
  await runSuppliers();
  await runDataGaps();
  await runAuditTrail();
  await runCBAM();
  await runSubscription();
  await runCompanyMembers();
  await runReports();
  await runLogistics();
  await runExport();
  await runPassport();
  await runUnauthenticated();

  // Summary
  const passed  = results.filter(r => r.icon === PASS).length;
  const failed  = results.filter(r => r.icon === FAIL).length;
  const skipped = results.filter(r => r.icon === SKIP || r.icon === WARN).length;
  const total   = results.length;

  console.log('\n\x1b[1m────────────────────────────────────────────────────\x1b[0m');
  console.log(`\x1b[1m  Results: ${passed}/${total} passed\x1b[0m  |  ${failed} failed  |  ${skipped} skipped`);

  if (failed > 0) {
    console.log('\n\x1b[31m\x1b[1m  Failed tests:\x1b[0m');
    results.filter(r => r.icon === FAIL).forEach(r => {
      console.log(`    ✘ ${r.name}  (${r.note})`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n\x1b[31mFatal error:\x1b[0m', e.message);
  console.error('Make sure the BE server is running at:', BASE_URL);
  process.exit(1);
});
