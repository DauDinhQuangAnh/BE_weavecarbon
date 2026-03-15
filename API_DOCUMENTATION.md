# WeaveCarbon API Documentation

Tai lieu tong quan API cho FE va BE su dung chung mot "tieng noi" (single source of truth), duoc tong hop tu code dang chay trong `src/server.js`, `src/routes/*`, `src/validators/*`, `src/services/*`.

- Last updated: 2026-02-25
- API version: 1.0.0 (theo `package.json`)
- Base path: `/api`

## 1. Muc tieu tai lieu

- Dong bo contract giua FE va BE: endpoint, auth, request, response, ma loi.
- Chot ro cac quy uoc du lieu de tranh "doan y" khi tich hop.
- Ghi nhan cac diem lech contract hien tai de 2 ben xu ly thong nhat.

## 2. Base URL, Headers, Content-Type

- Local default: `http://localhost:4000` (neu khong set `PORT`)
- Health check: `GET /health`
- API endpoints: `http://localhost:4000/api/...`

Headers chung:

- `Content-Type: application/json` (da so endpoint)
- `Authorization: Bearer <access_token>` (cho endpoint can auth)

Luu y ve download:

- `GET /api/reports/:id/download` va `GET /api/export/markets/:market_code/documents/:document_id/download` tra ve binary stream (khong phai JSON khi thanh cong).
- FE nen goi voi `responseType: 'blob'` (axios) hoac xu ly stream/blob (fetch).

## 3. Authentication va Phan quyen

### 3.1 JWT

- Access token va refresh token duoc cap qua auth APIs.
- Access token duoc gui qua header `Authorization: Bearer ...`.
- JWT payload co cac field chinh:
  - `sub` (user id)
  - `email`
  - `roles` (array: `b2b`, `b2c`, ...)
  - `company_id`
  - `is_demo`

### 3.2 Middleware phan quyen

- `authenticate`: bat buoc co access token hop le.
- `requireRole('b2b')`: bat buoc user co role `b2b`.
- `requireCompanyAdmin`: bat buoc la admin trong `company_members`.
- `requireCompanyMember`: bat buoc la thanh vien active trong `company_members`.

### 3.3 Company context

- Da so API B2B can `companyId`.
- Neu user khong co company, BE thuong tra:
  - `404 NO_COMPANY` hoac
  - `400 NO_COMPANY` (tuy module)

## 4. Response envelope chuan

### 4.1 Success

```json
{
  "success": true,
  "data": {},
  "message": "optional",
  "meta": {}
}
```

### 4.2 Error

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

### 4.3 Validation error (422)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "field_name",
        "message": "Validation message",
        "value": "invalid_value"
      }
    ]
  }
}
```

## 5. Quy uoc du lieu chung

- `id`: UUID string.
- Datetime: ISO-8601 (`2026-02-25T10:30:00.000Z`).
- Date-only: `YYYY-MM-DD`.
- Pagination format (list APIs):
  - `data.items[]`
  - `data.pagination = { page, page_size, total, total_pages }`

### 5.1 Enum chinh dang dung

- User role: `b2b | b2c | admin`
- Company member role: `admin | member | viewer`
- Company member status: `active | invited | disabled`
- Product DB status: `draft | active | archived`
- Product FE status (response): `draft | published | archived` (active map thanh published)
- Shipment status: `pending | in_transit | delivered | cancelled`
- Report status: `processing | completed | failed`
- Export market status: `draft | incomplete | ready | verified`

### 5.2 Naming convention hien tai

Codebase hien tai dang co ca `snake_case` va `camelCase` tuy module.

- Auth, reports, logistics, export-markets: nghieng ve `snake_case`
- Products, batches: nghieng ve `camelCase` cho payload FE

Nguyen tac tich hop:

- FE phai gui dung key theo tung endpoint (khong auto convert global).

## 6. Rate limiting

Tat ca `/api/*` di qua `apiLimiter`:

- Window: 15 phut
- Max:
  - Dev: 1000 requests
  - Production: 100 requests

Limiter dac thu:

- `POST /api/auth/signup`: 1h, dev 50 / prod 5
- `POST /api/auth/signin`: 15p, dev 50 / prod 10 (skip successful requests)
- `POST /api/auth/refresh`: 1p, dev 100 / prod 30
- `POST /api/auth/verify-email/resend`: 5p, dev 20 / prod 3
- `GET /api/auth/google` va `/google/callback`: 5p, dev 120 / prod 30

## 7. API Catalog theo module

## 7.1 System

### `GET /health`

- Auth: Khong
- Muc dich: Health check service
- Response: `status`, `timestamp`, `uptime`

## 7.2 Auth Module (`/api/auth`)

### `POST /signup`

- Auth: Khong
- Body:
  - `email` (required, email)
  - `password` (required, >=8, uppercase/lowercase/number/special)
  - `full_name` (required, 2-100)
  - `role` (`b2b | b2c`)
  - `company_name` (required neu `role=b2b`)
  - `business_type` (required neu `role=b2b`: `shop_online | brand | factory`)
  - `target_markets` (optional array)
  - `phone` (optional E.164)
- Success: `201`
- Notes:
  - Neu email da ton tai nhung chua verify, account cu se bi xoa va tao lai.
  - Tra ve `requires_email_verification: true`.

### `POST /signin`

- Auth: Khong
- Body: `email`, `password`, `remember_me?`
- Success: `200`
- Response chinh:
  - `user`, `profile`, `roles`
  - `company` (neu co)
  - `company_membership` (neu co)
  - `tokens { access_token, refresh_token, token_type, expires_in, expires_at }`
- Errors:
  - `401 INVALID_CREDENTIALS`
  - `403 EMAIL_NOT_VERIFIED`

### `POST /signout`

- Auth: Yes
- Body: `all_devices?`
- Success: `200`
- Response: `sessions_revoked`, `all_devices`

### `POST /refresh`

- Auth: Khong (dung refresh token)
- Body: `refresh_token` (required)
- Success: `200`
- Response: cap `tokens` moi
- Error: `401 INVALID_REFRESH_TOKEN`

### `POST /demo`

- Auth: Khong
- Body:
  - `role` (`b2b | b2c`)
  - `demo_scenario?` (`empty | sample_data | full`)
- Success: `200`
- Response:
  - `user.is_demo`
  - `company?`
  - `tokens`
  - `limitations`

### `GET /verify-email`

- Auth: Khong
- Query: `token`, `email`
- Behavior:
  - Neu browser prefers HTML: tra trang HTML ket qua verify.
  - Neu API client: tra JSON.
- Success:
  - Verify moi: mark email verified + cap token.
  - Da verify: tra message "already verified".

### `POST /verify-email`

- Auth: Khong
- Body: `token`, `email`
- Success: `200` + auto-login tokens

### `POST /verify-email/resend`

- Auth: Khong
- Body: `email`
- Success: `200`
- Notes:
  - Neu email khong ton tai, BE van tra success generic (khong leak user existence).

### `GET /google`

- Auth: Khong
- Query:
  - `intent`: `signin | signup` (default `signin`)
  - `role`: `b2b | b2c` (signin flow)
- Response: redirect sang Google OAuth URL

### `GET /google/callback`

- Auth: Khong
- Query: `code`, `state`
- Response: redirect ve frontend callback URL, data nam trong URL hash.
- Hash thanh cong co the gom:
  - `access_token`, `refresh_token`, `token_type`, `expires_in`
  - `provider=google`
  - `auth_intent`, `is_new_user`
  - `requires_company_setup`
  - `requires_email_verification`
  - `verification_email_sent`
  - `next_step`
- Hash loi:
  - `error`
  - `error_description`

### `GET /check-company`

- Auth: Yes
- Muc dich: check user B2B da co company chua
- Response:
  - `has_company`
  - `is_b2b`
  - `company_id`

## 7.3 Dashboard Module (`/api/dashboard`)

### `GET /overview`

- Auth: Yes + role `b2b`
- Query: `trend_months?` (1..12, default 6)
- Success: `200`
- Response:
  - `stats`
  - `carbon_trend[]`
  - `emission_breakdown[]`
  - `market_readiness[]`
  - `recommendations[]`
  - `meta`
- Errors:
  - `400 INVALID_PARAMETER` (trend_months)
  - `404 COMPANY_NOT_FOUND`

## 7.4 Account Module (`/api/account`)

### `GET /`

- Auth: Yes
- Muc dich: lay profile + company

### `PUT /profile`

- Auth: Yes
- Body:
  - `full_name` (required)
  - `email?`

### `POST /company`

- Auth: Yes
- Muc dich: tao company cho user chua co company
- Body:
  - `name`
  - `business_type`
  - `target_markets?`
- Errors:
  - `400 ALREADY_HAS_COMPANY`

### `PUT /company`

- Auth: Yes + role `b2b` + company admin
- Body: `name`, `business_type`

### `POST /change-password`

- Auth: Yes
- Body:
  - `new_password`
  - `confirm_password` (must match)

## 7.5 Subscription Module (`/api/subscription`)

### `GET /`

- Auth: Yes + role `b2b`
- Muc dich: lay plan, limits, usage + trial/cycle status
- Response:
  - `current_plan`
  - `plan_details`
  - `limits`
  - `usage`
  - `trial { started_at, ends_at, expired, days_remaining }`
  - `standard_cycle { started_at, expires_at, expired, days_remaining }`
  - `features_locked` (true khi Starter het trial)
  - `trial_days` (=14)
  - `standard_cycle_days` (=30)
  - `active_window { started_at, ends_at, expired, days_remaining }` (window theo plan hien tai)
  - `next_action`: `trial_active | upgrade_required | subscription_active | renew_required | contact_sales`

### `POST /upgrade`

- Auth: Yes + role `b2b` + company admin
- Body:
  - `target_plan`: `trial | standard | export`
  - `standard_sku_limit`: required khi `target_plan=standard`, gia tri `20 | 35 | 50`
  - `billing_cycle`: `monthly` (30 days per purchase)
  - `payment_provider?`: `vnpay`
- Success:
  - Neu `target_plan=trial|standard`: tra payment session VNPay (`payment_url`, `vnpay_url`, `session_id`, `transaction_ref`, `amount`)
  - Neu `target_plan=export`: tra thong tin lien he (`contact { name, phone }`)
 - Notes:
  - Plan chi duoc cap nhat sau callback thanh cong (`vnp_ResponseCode=00`)
  - `current_plan` cua cong ty van la `standard`
  - Moi lan mua `standard` se cong them vao `standard_sku_limit`
  - Vi du: dang co `20` SKU, mua them `35` -> tong `55`; mua them `50` -> tong `105`
  - Moi lan thanh toan thanh cong se reset chu ky 30 ngay tinh tu thoi diem mua cua goi Standard
  - BE verify `vnp_SecureHash` truoc khi chap nhan callback

### `GET /vnpay/mock-checkout?session_id=<uuid>`

- Auth: Khong
- Muc dich: trang mock checkout VNPay de test local
- Response: HTML co nut thanh cong/that bai

### `GET /vnpay/return?session_id=<uuid>&vnp_ResponseCode=00`

- Auth: Khong
- Muc dich:
  - `VNPAY_MODE=mock`: callback mock bang `session_id`
  - `VNPAY_MODE=sandbox|production`: callback that cua VNPay (`vnp_TxnRef`, `vnp_ResponseCode`, `vnp_SecureHash`)
- Rule:
  - `vnp_ResponseCode=00`: thanh toan thanh cong -> cap nhat `current_plan=standard` va tinh 30 ngay
  - ma khac `00`: giu nguyen plan
- Response: HTML ket qua thanh toan

### `GET /vnpay/ipn`

- Auth: Khong
- Muc dich: endpoint IPN de VNPay goi server-to-server
- Rule:
  - Verify chu ky `vnp_SecureHash`
  - Neu hop le: xac nhan giao dich va cap nhat plan neu thanh cong
- Response theo dinh dang VNPay:
  - `{ "RspCode": "00", "Message": "Confirm Success" }`

### Plan lock behavior (`PLAN_LOCKED`)

- Khi company o `trial` va het trial 14 ngay (`features_locked=true`), BE se chan cac request mutate tren nhom route:
  - `/api/products/*`
  - `/api/product-batches/*`
  - `/api/logistics/*`
  - `/api/export/markets/*`
  - `/api/reports/*`
  - `/api/company/members/*`
  - `/api/account/company`
- HTTP: `403`
- Error code: `PLAN_LOCKED`
- Luong `/api/subscription/*` van duoc phep de nang cap.

## 7.6 Company Members Module (`/api/company/members`)

### `GET /`

- Auth: Yes + role `b2b` + company member
- Query:
  - `status?`: `active | invited | disabled`
  - `role?`: `admin | member | viewer`
- Response:
  - `data[]` members
  - `meta { total, active, invited, disabled }`

### `POST /`

- Auth: Yes + role `b2b` + company admin
- Body:
  - `email`
  - `full_name`
  - `password`
  - `role`: `member | viewer`
  - `send_notification_email?` (default true)
- Success: `201`

### `PUT /:id`

- Auth: Yes + role `b2b` + company admin
- Body:
  - `role?`: `member | viewer`
  - `status?`: `active | disabled`

### `DELETE /:id`

- Auth: Yes + role `b2b` + company admin
- Muc dich: remove member

## 7.7 Products Module (`/api/products`)

Tat ca endpoint module nay: Auth Yes + role `b2b`.

### `GET /`

- Query:
  - `search?`, `status?`, `category?`
  - `page?`, `page_size?`
  - `sort_by?` (`created_at|updated_at|name|sku|total_co2e`)
  - `sort_order?` (`asc|desc`)
  - `include?`
- Response: `items[]` + `pagination`

### `GET /bulk-template`

- Query: `format?` (`xlsx|csv`)
- Hien trang thai: `501 NOT_IMPLEMENTED`

### `POST /bulk-import/validate`

- Body: `rows?` (array)
- Hien trang thai: placeholder validate (tra `isValid: true` mac dinh)

### `POST /bulk-import/file`

- Hien trang thai: `501 NOT_IMPLEMENTED`

### `GET /:id`

- Response: full product payload + snapshot merged

### `POST /`

- Body (chinh):
  - `productCode`, `productName`
  - `productType?`, `weightPerUnit?`, `quantity?`
  - `materials?`, `accessories?`, `productionProcesses?`, `energySources?`
  - `carbonResults?`
  - `save_mode?` (`draft|publish`)
- Success: `201`
- Notes:
  - `save_mode=publish` se tao shipment neu du logistics data.

### `PUT /:id`

- Body giong create (khong co `save_mode`)
- Success: update product + tang `version` snapshot

### `PATCH /:id/status`

- Body: `status`
- Muc dich: doi trang thai product.
- Error dac thu:
  - `MISSING_DOMESTIC_DOCUMENTS` (400): khong du tai lieu noi dia bat buoc de publish.

### `DELETE /:id`

- Soft delete: set status `archived`

### `POST /bulk-import`

- Body:
  - `rows` (required, non-empty)
  - moi row toi thieu: `sku`, `productName`
  - `save_mode?` (`draft|publish`)
- Response:
  - `imported`, `failed`, `errors[]`, `ids[]`

## 7.8 Product Batches Module (`/api/product-batches`)

Tat ca endpoint module nay: Auth Yes + role `b2b`.

### `GET /`

- Query:
  - `search?`
  - `status?` (`draft|active|archived|all` theo validator hien tai)
  - `page?`, `page_size?`
- Response: `items[]` + `pagination`

### `GET /:id`

- Response: batch detail + `items[]`

### `POST /`

- Body:
  - `name` (required)
  - `description?`
  - `originAddress?` (object)
  - `destinationAddress?` (object)
  - `destinationMarket?`
  - `transportModes?` (`sea|air|road|rail`)

### `PATCH /:id`

- Body: cap nhat metadata batch (cac field nhu create)

### `DELETE /:id`

- Soft delete batch (`archived`)

### `POST /:id/items`

- Body:
  - `product_id` (required)
  - `quantity` (>0)
  - `weight_kg?`
  - `co2_per_unit?`

### `PATCH /:id/items/:product_id`

- Body: `quantity?`, `weight_kg?`, `co2_per_unit?`

### `DELETE /:id/items/:product_id`

- Remove product khoi batch

### `PATCH /:id/publish`

- Publish batch, co the auto-create shipment neu du logistics data
- Errors dac thu:
  - `BATCH_EMPTY`
  - `INVALID_BATCH_STATUS_TRANSITION`
  - `MISSING_DOMESTIC_DOCUMENTS` (400): lo hang con thieu tai lieu noi dia bat buoc theo san pham.

## 7.9 Logistics Module (`/api/logistics`)

Tat ca endpoint module nay: Auth Yes + role `b2b`.

### `GET /shipments`

- Query:
  - `search?`
  - `status?` (`pending|in_transit|delivered|cancelled|all`)
  - `transport_mode?` (`road|sea|air|rail`)
  - `date_from?`, `date_to?` (`YYYY-MM-DD`)
  - `page?`, `page_size?`
  - `sort_by?` (`created_at|updated_at|estimated_arrival|total_co2e`)
  - `sort_order?` (`asc|desc`)
- Response: `items[]` + `pagination`

### `GET /overview`

- Response:
  - `total_shipments`
  - status counters
  - `total_co2e`

### `GET /shipments/:id`

- Response:
  - shipment detail
  - `origin`, `destination`
  - `legs[]`
  - `products[]`

### `POST /shipments`

- Body:
  - `reference_number?`
  - `origin` (required object)
  - `destination` (required object)
  - `estimated_arrival?`
  - `legs[]` (required, >=1)
  - `products[]` (required, >=1)
- Success: `201`
- Error dac thu: `PRODUCT_NOT_IN_COMPANY`, `EMPTY_SHIPMENT_PRODUCTS`

### `PATCH /shipments/:id`

- Body: metadata update (`reference_number`, `origin`, `destination`, `estimated_arrival`)

### `PATCH /shipments/:id/status`

- Body:
  - `status` (`pending|in_transit|delivered|cancelled`)
  - `actual_arrival?` (`YYYY-MM-DD`)
- Error dac thu: `INVALID_SHIPMENT_STATUS_TRANSITION`

### `PUT /shipments/:id/legs`

- Body:
  - `legs[]` thay the toan bo legs
- Rules:
  - `leg_order` phai unique va lien tuc bat dau tu 1
- Error dac thu: `INVALID_SHIPMENT_PAYLOAD`

### `PUT /shipments/:id/products`

- Body:
  - `products[]` thay the toan bo products shipment
- Error dac thu: `PRODUCT_NOT_IN_COMPANY`

## 7.10 Export Markets Module (`/api/export/markets`)

Tat ca endpoint module nay: Auth Yes + role `b2b`.

### `GET /`

- Muc dich: list all market compliance cards cho company
- Response market card gom:
  - market info (`market_code`, `status`, `score`, ...)
  - `required_documents[]`
  - `documents[]`
  - `product_scope[]`
  - `carbon_data[]`
  - `recommendations[]`
  - `emission_factors[]`
- Notes:
  - Service tu dong ensure markets + required document placeholders.
  - Required documents duoc gan cung trong BE (khong lay runtime tu `compliance_document_requirements` nua).
  - Template market hardcoded hien tai:
    - `VN`, `EU`, `US`, `JP`, `KR`, `AU`, `ASEAN`, `TH`, `SG`, `MY`, `ID`, `PH`, `CA`, `UK`, `CN`, `IN`
  - Script dong bo DB snapshot theo template:
    - `sync_hardcoded_market_requirements.sql`

### `POST /:market_code/recommendations/:recommendation_id/actions`

- Body: `action` (`start|complete|dismiss|reset|mark_completed`)

### `POST /:market_code/products`

- Body:
  - `product_id` (required)
  - `hs_code?`
  - `notes?`
- Success: `201`

### `PATCH /:market_code/products/:product_id`

- Body: `hs_code?`, `notes?`

### `DELETE /:market_code/products/:product_id`

- Remove product scope

### `PATCH /:market_code/carbon-data/:scope`

- Params:
  - `scope`: `scope1|scope2|scope3`
- Body:
  - `value` (required number)
  - `unit?`, `methodology?`, `data_source?`, `reporting_period?`

### `POST /:market_code/documents/:document_id/upload`

- Hien tai mo phong upload metadata (chua co multer)
- Body metadata:
  - `document_name?`, `document_code?`, `original_filename?`
  - `file_size_bytes?`, `mime_type?`, `checksum_sha256?`
  - `storage_key? | document_path? | file_path?` (luu duong dan file)
  - `product_ids?` (array/string): gan tai lieu vao danh sach san pham

### `POST /:market_code/documents/import`

- Muc dich: import mapping tai lieu <-> san pham hang loat
- Body:
  - `rows[]` (required)
  - Moi row ho tro:
    - `product_id | product_code | sku`
    - `document_id | document_code`
    - `document_name?`
    - `storage_key | file_path | document_path | path | document_url?`
    - `status?` (`missing|uploaded|approved|expired`)
- Response:
  - `imported`, `failed`, `errors[]`

### `GET /:market_code/documents/:document_id/download`

- Thanh cong: binary file stream
- Co check path traversal
- Trong non-production, neu file local chua ton tai co the tao placeholder file neu `DISABLE_DOWNLOAD_PLACEHOLDER != true`.

### `DELETE /:market_code/documents/:document_id`

- Mark document ve `missing`, clear storage metadata

### `POST /:market_code/reports`

- Body: `file_format` (`xlsx|csv|pdf`)
- Success: `202`
- Rule:
  - Market status phai `ready` hoac `verified`, neu khong tra `MARKET_NOT_READY`.

### Error code map dac thu module export markets

- `MARKET_NOT_FOUND` (404)
- `RECOMMENDATION_NOT_FOUND` (404)
- `PRODUCT_NOT_FOUND` (404)
- `PRODUCT_SCOPE_NOT_FOUND` (404)
- `DOCUMENT_NOT_FOUND` (404)
- `DOCUMENT_FILE_NOT_FOUND` (404)
- `MARKET_NOT_READY` (400)
- `INVALID_ACTION` (400)

## 7.11 Reports Module (`/api/reports`)

Tat ca endpoint module nay: Auth Yes + role `b2b`.

### `GET /`

- Query:
  - `search?`, `type?`, `status?`
  - `date_from?`, `date_to?`
  - `page?`, `page_size?`
  - `sort_by?` (`created_at|updated_at|title|status|generated_at`)
  - `sort_order?` (`asc|desc`)
- Response: `items[]` + `pagination`

### `POST /exports`

- Muc dich: tao dataset export job (unified pipeline)
- Body:
  - `dataset_type` (`product|activity|audit|users|history|analytics|company`)
  - `file_format?` (`csv|xlsx`)
  - `title?`
- Success: `202`, response co `report_id`, `status`, `records`

### `POST /export-jobs`

- Alias fallback cho `/exports`

### `GET /export-sources`

- Muc dich: lay count tong hop
- Response keys hien tai: `products`, `activity`, `audit`, `users`, `history`

### `GET /export-sources/:type`

- Type hop le:
  - `products|product`
  - `activity`
  - `audit`
  - `users`
  - `history`
  - `analytics`
  - `company`
- Response:
  - `dataset_type`
  - `count`
  - `last_updated`

### `GET /export-data/:type`

- Type hop le giong `/export-sources/:type`
- Response:
  - `dataset_type`
  - `columns[]`
  - `rows[]`
  - `total`
- Muc dich: FE tu sinh file client-side (XLSX/CSV)

### `GET /:id`

- Lay report detail

### `GET /:id/status`

- Poll nhanh trang thai report

### `GET /:id/download`

- Thanh cong: binary file stream
- Neu report chua ready: `409 REPORT_NOT_READY`
- Neu local file missing:
  - non-prod co the tao placeholder
  - hoac `404 FILE_NOT_FOUND` tuy env

### `POST /`

- Tao report job manual
- Body:
  - `report_type` (`carbon_audit|compliance|export_declaration|sustainability|manual|export_data`)
  - `title` (required)
  - `description?`
  - `period_start?`, `period_end?`
  - `target_market?`
  - `file_format?` (`pdf|xlsx|csv`)
  - `filters?`
- Success: `202` + `id`, `status`

### `DELETE /:id`

- Xoa report record + best-effort xoa file local

### `PATCH /:id/status`

- Body: `status` (`processing|completed|failed`)
- Co validate status transition

## 8. Luong tich hop FE de nghi

### 8.1 Auth flow chuan

1. `POST /api/auth/signin` de lay token.
2. Gan `Authorization: Bearer <access_token>` cho request protected.
3. Khi `401` do token het han, goi `POST /api/auth/refresh` voi `refresh_token`.
4. Update token moi va retry request.

### 8.2 Report export flow

1. Tao export: `POST /api/reports/exports` (hoac `/export-jobs`).
2. Poll: `GET /api/reports/:id/status` den khi `status=completed`.
3. Download: `GET /api/reports/:id/download`.

### 8.3 Export-data client-side flow

1. Lay data: `GET /api/reports/export-data/:type`.
2. FE dung dataset `columns + rows` de tao XLSX/CSV.

## 9. Known contract mismatches (can FE/BE thong nhat)

1. Products status transition:
- `PATCH /api/products/:id/status` validator dang cho `status=draft|active|archived`.
- Service business logic lai dung `draft|published|archived`.
- He qua: `active` co the bi reject transition.
- Khuyen nghi: thong nhat ngay 1 bo status contract (`published` cho FE, map `active` o BE).

2. Products list status filter:
- `GET /api/products` validator dang cho `status=draft|active|archived|all`.
- Response item.status lai map `active -> published`.
- Khuyen nghi: cap nhat validator de chap nhan `published` (hoac FE su dung `active` cho filter, `published` cho display).

3. Product batches status filter:
- Validator cho `status=active`, trong khi bang `product_batches` dung `draft|published|archived`.
- Khuyen nghi: doi `active` thanh `published` trong validator de dong bo.

4. Reports export source aggregate:
- `GET /api/reports/export-sources` chi tra 5 nhom (`products/activity/audit/users/history`),
  khong gom `analytics/company`.
- Trong khi `GET /api/reports/export-sources/:type` van ho tro `analytics/company`.

5. Products bulk endpoints:
- `GET /api/products/bulk-template` va `POST /api/products/bulk-import/file` chua implement (`501`).
- `POST /api/products/bulk-import/validate` dang placeholder.

## 10. Checklist truoc khi FE release

- Xac nhan map status product/batch da thong nhat voi BE.
- Xac nhan xu ly download blob cho reports/compliance documents.
- Xac nhan luong auth callback Google (`/auth/callback#...`) da parse dung hash params.
- Xac nhan handling `NO_COMPANY` cho user B2B chua setup xong.
- Xac nhan retry refresh token khi gap `401`.
