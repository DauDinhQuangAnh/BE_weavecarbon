# Kế hoạch rà soát toàn bộ trang WeaveCarbon

## 1. Mục tiêu

Rà soát lần lượt toàn bộ 19 trang chính trong dashboard B2B trước khi sửa code. Mỗi phase phải xác định được:

- trang dùng để làm gì và có đúng với nhu cầu hiện tại không;
- toàn bộ nút, form, modal, link, bảng, filter, upload, download và trạng thái loading/error/empty;
- dữ liệu frontend lấy từ đâu và được biến đổi thế nào;
- endpoint, middleware quyền, service, database table/migration và audit log tương ứng ở backend;
- phần nào là dữ liệu thật, demo, cache, dữ liệu sinh ra hoặc giả định nghiệp vụ;
- test hiện có chứng minh được gì và chưa chứng minh được gì;
- lỗi hoặc khoảng trống theo mức P0, P1, P2;
- tiêu chí nghiệm thu cần đạt khi triển khai sau này.

Giai đoạn rà soát ban đầu không sửa frontend, backend, migration hoặc dữ liệu. Kết quả rà soát có thể dẫn đến một phase được triển khai riêng; khi đó phải ghi rõ `IMPLEMENTED`, `VERIFIED LOCALLY`, `VERIFIED ON STAGING` hoặc `ACCEPTED`, thay vì giữ trạng thái `REVIEWED / NOT IMPLEMENTED`.

## 2. Quy trình bắt buộc cho mỗi phase

1. Xác định route chính, demo route và toàn bộ route con thuộc nghiệp vụ.
2. Đọc page, client component, hook, context, helper, API client và bản dịch.
3. Lập danh sách toàn bộ control có thể thao tác và điều kiện enable/disable/visible.
4. Theo từng thao tác từ FE request đến BE route, middleware, service, query và bảng dữ liệu.
5. Kiểm tra authentication, role, Company Admin, tenant isolation và subscription gate.
6. Kiểm tra loading, empty state, error, retry, double submit, cache, pagination và dữ liệu lớn.
7. Kiểm tra demo mode có ghi dữ liệu hay gây hiểu nhầm dữ liệu thật không.
8. Chạy test tập trung hiện có; ghi rõ test source-contract, unit, integration hay browser/E2E.
9. Khi môi trường cho phép, mở trang và thử toàn bộ nút bằng tài khoản phù hợp. Nếu thiếu tài khoản hoặc database thì ghi rõ giới hạn, không suy đoán là đã hoạt động.
10. Viết file phase theo cùng cấu trúc với Phase 01 và cập nhật trạng thái trong `README.md`.

## 3. Điều kiện hoàn thành một phase

Một phase chỉ được chuyển sang `REVIEWED` khi file Markdown có đủ:

- phạm vi route và mã nguồn;
- sơ đồ hoặc mô tả luồng dữ liệu;
- bảng toàn bộ chức năng và nút bấm;
- mapping FE -> API -> route -> service -> database;
- đánh giá quyền và tenant;
- đánh giá UX và tính hợp lý nghiệp vụ;
- kết quả test có lệnh và số lượng pass/fail;
- danh sách P0/P1/P2;
- checklist nghiệm thu triển khai;
- các giới hạn chưa được xác minh.

## 4. Thứ tự và phạm vi từng phase

### Phase 01 - Vận hành carbon

- Route: `/carbon-operations` và `/demo/carbon-operations`.
- Trọng tâm: facility, process, measurement point, activity lineage, review và dynamic allocation.
- BE: `industrialCore`, `dynamicAllocation`, các migration industrial core.
- Đầu ra: `PHASE_01_CARBON_OPERATIONS.md`.
- Trạng thái: `IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING`.

### Phase 02 - Sản phẩm

- Route chính: `/products`.
- Route con: `/summary/[slug]`, `/passport-dashboard` và luồng QR/passport gắn với sản phẩm.
- FE trọng tâm: `ProductsClient`, bulk upload, preview/validation, batch management, product-detail components, QR và `productsApi`.
- BE trọng tâm: `products`, `product-batches`, `productsService`, bulk-import validation/execution, carbon scoring, shipment sync và operational job nếu được dùng.
- Nút/luồng phải kiểm tra: tạo, sửa, xóa, publish/unpublish, tìm kiếm, lọc, phân trang, bulk upload, tải template, batch CRUD, batch items, QR, mở chi tiết và trạng thái carbon authoritative/proxy.
- Test tập trung: products API, product service, bulk import, batch service và persistence carbon.
- Đầu ra: `PHASE_02_PRODUCTS.md`.

### Phase 03 - Logistics

- Route chính: `/logistics`.
- Route con: `/assessment`, `/transport`, `/track-shipment` và các demo route tương ứng.
- FE trọng tâm: `LogisticsClient`, `SupplyChainMap`, assessment wizard, route suggestion/optimizer, intermodal planner, transport và shipment tracking.
- BE trọng tâm: `logistics`, shipment simulation và dữ liệu logistics được đồng bộ từ sản phẩm/lô hàng.
- Nút/luồng phải kiểm tra: tạo/cập nhật/xóa shipment, chọn tuyến, bản đồ, road/rail/sea routing, assessment nhiều bước, tracking, trạng thái giao hàng và dữ liệu phát thải vận tải.
- Kiểm tra riêng: API bản đồ bên ngoài, cache tuyến đường, giới hạn retry/concurrency, tọa độ và nhãn chủ quyền Việt Nam.
- Đầu ra: `PHASE_03_LOGISTICS.md`.

### Phase 04 - Tính carbon

- Route chính: `/carbon-calculator`.
- Route con: `/calculation-history`; `/cbam-report` chỉ kiểm tra hướng điều hướng, nội dung báo cáo để Phase 19.
- FE trọng tâm: `CarbonCalculator`, calculation history, bảng lịch sử, carbon engine/adapters/factor registry.
- BE trọng tâm: `carbon-calculations`, `carbon-factors`, electricity/fuel invoices và calculation snapshots.
- Nút/luồng phải kiểm tra: nhập activity data, chọn factor, tính lại, lưu snapshot, xem lịch sử, lọc, mở chi tiết và liên kết nguồn chứng từ.
- Kiểm tra riêng: đơn vị vật lý, precision/rounding, factor version, proxy so với authoritative result, tính lặp lại và tenant isolation.
- Đầu ra: `PHASE_04_CARBON_CALCULATOR.md`.

### Phase 05 - Chứng từ

- Route: `/evidence` và demo route.
- FE trọng tâm: evidence upload/list/filter, trust/level badges, evidence V2 API, AI/OCR review và controlled activity promotion panel.
- BE trọng tâm: `evidence`, evidence storage, checksum, lock, extraction review, AI activity promotion và audit trail.
- Nút/luồng phải kiểm tra: upload, xem/tải, sửa metadata khi được phép, khóa, lọc theo sản phẩm/trạng thái, OCR suggestion, human review và promote thành activity.
- Kiểm tra riêng: MIME/size policy, path traversal, checksum, immutable lock, dữ liệu AI chỉ là suggestion và quyền tải file.
- Đầu ra: `PHASE_05_EVIDENCE.md`.

### Phase 06 - Kiểm tra dữ liệu

- Route: `/data-gap` và demo route.
- FE trọng tâm: danh sách data gap, form tạo, upload evidence, filter và trạng thái xử lý.
- BE trọng tâm: `data-gaps`, supplier request linkage và audit event.
- Nút/luồng phải kiểm tra: tạo gap, gán đối tượng/người xử lý, cập nhật trạng thái, upload, đóng/mở lại và empty/error state.
- Kiểm tra riêng: gap có phản ánh dữ liệu thiếu thật hay chỉ là checklist thủ công; tránh coi thiếu log là dữ liệu bằng 0.
- Đầu ra: `PHASE_06_DATA_GAP.md`.

### Phase 07 - Quản trị dữ liệu

- Route: `/data-governance` và demo route.
- FE trọng tâm: `DataGovernanceClient`, DQL assessment và factor proposal.
- BE trọng tâm: `dataQualityGovernance`, controls, services và migration DQL/factor governance.
- Nút/luồng phải kiểm tra: tạo DQL, tạo factor proposal, evidence linkage, review/approval nếu có và danh sách revision.
- Kiểm tra riêng: thang điểm DQL, factor version/effective date, nguồn factor, evidence gate và khả năng factor chưa review đi vào phép tính.
- Đầu ra: `PHASE_07_DATA_GOVERNANCE.md`.

### Phase 08 - MRV Việt Nam

- Route: `/vn-mrv` và demo route.
- FE trọng tâm: `VnMrvClient`, applicability case, measurement plan và filing snapshot.
- BE trọng tâm: `vnMrv`, corporate GHG inventory linkage, DQL/evidence dependencies và migration vòng đời MRV.
- Nút/luồng phải kiểm tra: tạo hồ sơ áp dụng, tạo measurement plan, chọn inventory, chuẩn bị filing và xem blockers.
- Kiểm tra riêng: effective date, cơ sở pháp lý, ranh giới tổ chức/vận hành, Scope 1/2/3, QA/QC, uncertainty và tuyên bố không thay thế kết luận pháp lý.
- Đầu ra: `PHASE_08_VN_MRV.md`.

### Phase 09 - Giảm phát thải và hạn ngạch

- Route: `/mitigation-operations` và demo route.
- FE trọng tâm: initiative, scenario, allowance allocation và position snapshot.
- BE trọng tâm: `mitigationOperations`, controls/service và migration liên quan.
- Nút/luồng phải kiểm tra: tạo revision initiative, scenario, allocation reference và position snapshot.
- Kiểm tra riêng: gross emissions không bị tự động trừ bởi allowance/credit, evidence gate, ownership claim và registry reconciliation.
- Đầu ra: `PHASE_09_MITIGATION_OPERATIONS.md`.

### Phase 10 - Industry Packs

- Route: `/industry-packs` và demo route.
- FE trọng tâm: chọn ngành, tạo pilot snapshot, activity lines, factor proposal và kết quả.
- BE trọng tâm: `industryPacks`, manifests, controls/service, fixtures cho bảy ngành và migration.
- Nút/luồng phải kiểm tra: chọn facility/process/product, nhập sản lượng/activity, chọn factor đã review, evidence và tạo snapshot.
- Kiểm tra riêng: taxonomy từng ngành, đơn vị, co-product allocation, factor mặc định, target mapping và disclaimer chuyên gia ngành.
- Đầu ra: `PHASE_10_INDUSTRY_PACKS.md`.

### Phase 11 - Rủi ro khí hậu

- Route: `/climate-risk` và demo route.
- FE trọng tâm: location revision, hazard assessment và portfolio snapshot.
- BE trọng tâm: `climateRisk`, controls/service và migration.
- Nút/luồng phải kiểm tra: lưu vị trí, tạo assessment, chọn scenario/dataset, tạo portfolio và xem members.
- Kiểm tra riêng: latitude/longitude, độ chính xác, historical so với projection, nguồn ERA5/CMIP6, uncertainty, dependency weight và tổng tỷ trọng 100%.
- Đầu ra: `PHASE_11_CLIMATE_RISK.md`.

### Phase 12 - Vận hành WeaveNode

- Route: `/weavenode` và demo route.
- FE trọng tâm: device fleet, health, meter hierarchy, reconciliation, release key và signed update history.
- BE trọng tâm: `weavenode`, signed ingestion, sequence/time provenance, controls/service và migrations.
- Nút/luồng phải kiểm tra: xem health/update, tạo hierarchy, chạy reconciliation, đăng ký public key và ghi update/rollback.
- Kiểm tra riêng: replay/sequence, clock drift, mTLS/key custody boundary, buffer, calibration, chữ ký Ed25519 và staged rollout.
- Đầu ra: `PHASE_12_WEAVENODE.md`.

### Phase 13 - Xuất khẩu và tuân thủ

- Route: `/export` và demo route.
- FE trọng tâm: `ExportClient`, configuration portal, shipment export workflow, carrier documents, compliance applicability, VN Customs, EU Import, ICS2, origin, textile label, GPSR, REACH, PCF và environmental claims.
- BE trọng tâm: `exportV2`, export markets, shipment export services, compliance controls và migrations R03-R20.
- Nút/luồng phải kiểm tra: cấu hình, khóa DPP, đồng bộ lines, container/package, readiness, upload/confirm carrier document, review/issue/handoff và webhook payload.
- Ranh giới: phase này kiểm tra workflow và wiring của nút tạo/tải tài liệu; nội dung chi tiết từng loại báo cáo/file được rà soát ở Phase 19 và tracker R01-R20.
- Kiểm tra riêng: actor hợp lệ, trạng thái draft/reviewed/issued/submitted, external event chỉ là ghi nhận, effective-date law và không tuyên bố đã nộp thật.
- Đầu ra: `PHASE_13_EXPORT_COMPLIANCE.md`.

### Phase 14 - Nhật ký kiểm toán

- Route: `/audit-trail` và demo route.
- FE trọng tâm: tải log, tìm kiếm, lọc actor/action/entity, member mapping và phân trang.
- BE trọng tâm: `auditTrail`, audit writer được gọi từ các route nghiệp vụ và tenant scope.
- Nút/luồng phải kiểm tra: search, filter, pagination, mở metadata/detail và export nếu có.
- Kiểm tra riêng: append-only, actor/time/request context, dữ liệu nhạy cảm, tính đầy đủ của event và không hiển thị log công ty khác.
- Đầu ra: `PHASE_14_AUDIT_TRAIL.md`.

### Phase 15 - Nhà cung cấp

- Route: `/suppliers` và demo route.
- FE trọng tâm: supplier CRUD/request và `SupplierNetworkPanel`.
- BE trọng tâm: `suppliers`, `supplierNetwork`, profile/site/relationship, climate/carbon snapshot, criticality model và portfolio.
- Nút/luồng phải kiểm tra: mời/thêm supplier, gửi request, profile/site/relationship CRUD, assessment, model, snapshot và portfolio detail.
- Kiểm tra riêng: invitation state, duplicate supplier, network cycle, dependency weights, evidence, tenant boundaries và dữ liệu nhà cung cấp tự khai.
- Đầu ra: `PHASE_15_SUPPLIERS.md`.

### Phase 16 - Thanh toán

- Route: `/billing` và demo route.
- FE trọng tâm: subscription state/lock, plan display, product usage, upgrade/payment controls.
- BE trọng tâm: `subscription`, plan rules, VNPay integration, idempotency và subscription middleware.
- Nút/luồng phải kiểm tra: chọn gói, tạo payment, callback/return, refresh trạng thái, trial/expired lock và lịch sử nếu có.
- Kiểm tra riêng: số tiền/currency, duplicate callback, pending/failed/success, quyền admin, plan gate và không mở khóa chỉ dựa vào FE state.
- Đầu ra: `PHASE_16_BILLING.md`.

### Phase 17 - Cài đặt

- Route chính: `/settings`.
- Route con: `/settings/ai`, `/AI_CONFIG`; các modal/thành phần quản lý thành viên và enterprise security.
- FE trọng tâm: `SettingClient`, `AISettings`, company members, profile/company settings và `EnterpriseSecuritySettings`.
- BE trọng tâm: `account`, `companyMembers`, `aiConfig`, `enterpriseSecurity`, auth/MFA/OIDC và incident/key lifecycle.
- Nút/luồng phải kiểm tra: cập nhật hồ sơ/công ty, thành viên và role, AI runtime config, MFA, OIDC, key/incident/acceptance controls.
- Kiểm tra riêng: secret masking, permission escalation, session invalidation, recovery code, AI provider fallback và cấu hình production acceptance.
- Đầu ra: `PHASE_17_SETTINGS.md`.

### Phase 18 - Tổng quan

- Route: `/overview` và demo route.
- FE trọng tâm: `OverviewPageClient`, charts, summary cards, CTA/navigation và dashboard data helpers.
- BE trọng tâm: `dashboard`, analytics queries/cache và các nguồn tổng hợp từ product, logistics, calculation, evidence, supplier.
- Nút/luồng phải kiểm tra: date/filter, chart interaction, card links, refresh và empty/error state.
- Kiểm tra riêng: định nghĩa KPI, đơn vị, kỳ thời gian, double counting, cache freshness và khả năng số tổng hợp khớp trang nguồn.
- Phase này đặt gần cuối để đối chiếu với kết luận của các trang nguồn trước đó.
- Đầu ra: `PHASE_18_OVERVIEW.md`.

### Phase 19 - Báo cáo

- Route: `/reports` và demo route; liên kết điều hướng từ `/cbam-report` nếu còn tồn tại.
- FE trọng tâm: `ReportClient`, các panel báo cáo, API source/data, preview, modal và mọi nút XLSX/CSV/PDF/JSON.
- BE trọng tâm: `reports`, report job queue, PDF/XLSX generation, audit bundle, corporate GHG và EU Textile EPR.
- Nút/luồng phải kiểm tra: chọn báo cáo, preview, tạo job, polling, tải file, lỗi/timeout, quyền, tên file, MIME và nội dung file.
- Đối chiếu bắt buộc với `EXPORT_REPORT_MASTER_TRACKER.md`; sau kiểm tra màn hình chung sẽ tiếp tục rà từng R01-R20 theo tracker hiện có.
- Kiểm tra riêng: source-of-truth, snapshot/version, cross-format parity, số liệu/tổng/rounding, provenance, legal status và khả năng mở file thực tế.
- Đầu ra: `PHASE_19_REPORTS.md`.

## 5. Chuỗi phụ thuộc

Thứ tự trên được chọn để kiểm tra từ dữ liệu nguồn đến dữ liệu tổng hợp:

```text
Carbon operations
  -> Products
  -> Logistics
  -> Carbon calculation
  -> Evidence / Data gaps / Data governance
  -> VN MRV / Mitigation / Industry packs / Climate risk / WeaveNode
  -> Export / Audit / Suppliers / Billing / Settings
  -> Overview
  -> Reports
```

Nếu một phase phát hiện lỗi dùng chung, lỗi đó được ghi ở phase phát hiện đầu tiên và tham chiếu lại ở các phase phụ thuộc. Không sửa trong giai đoạn review.

## 6. Kế hoạch triển khai sau khi review xong

Sau khi Phase 19 hoàn thành mới lập kế hoạch triển khai riêng. Kế hoạch đó sẽ:

1. Gộp các lỗi P0 dùng chung như quyền, tenant, loading/error và evidence selector.
2. Xác định thứ tự migration/API trước FE đối với thay đổi contract.
3. Chia thành các gói sửa nhỏ, mỗi gói có test và rollback boundary.
4. Không đổi trạng thái phase sang `IMPLEMENTED` nếu mới sửa code nhưng chưa chạy kiểm thử cần thiết.
5. Ghi riêng trạng thái `IMPLEMENTED`, `VERIFIED LOCALLY`, `VERIFIED ON STAGING` và `ACCEPTED`.

## 7. Phạm vi chưa bao gồm trong 19 phase dashboard

Các trang sau tồn tại trong repository nhưng không nằm trong sidebar B2B và chưa được coi là đã review theo kế hoạch này:

- authentication, callback, check-email và onboarding;
- landing page và calculator công khai;
- public passport;
- toàn bộ B2C donation, coupon, collection point và history;
- audit page công khai;
- error, not-found và global error boundaries.

Sau Phase 19 cần quyết định mở thêm một đợt review cho nhóm public/auth/B2C trước khi tuyên bố toàn bộ ứng dụng đã được rà soát.
