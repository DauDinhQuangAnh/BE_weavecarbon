# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 18: Tổng Quan (/overview)

> **Mã Phase:** PHASE-18  
> **Tên Module:** Bảng Điều Khiển Tổng Quan Doanh Nghiệp, Tổng Hợp Dấu Chân Carbon & Xu hướng Phát thải (Executive Overview Dashboard, Multi-Scope Aggregation, Carbon Trends & Readiness Synthesis)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/overview/page.tsx`, `Weavecarbon/components/dashboard/overview/OverviewPageClient.tsx`, `overviewPageHelpers.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/dashboard.js`, `BE_weavecarbon/src/services/dashboardService.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/overview` là điểm đến đầu tiên (landing cockpit) của ban lãnh đạo và giám đốc bền vững (CSO) khi đăng nhập vào WeaveCarbon. Trang chịu trách nhiệm tổng hợp toàn diện các chỉ số carbon và hiệu quả vận hành:
1. **4 Chỉ số Hiệu suất Cốt lõi (Core KPI Metrics):**
   - **Tổng lượng phát thải ($tCO_2e$):** Tổng hợp phát thải Scope 1, Scope 2 và Scope 3 qua các giai đoạn vòng đời (Nguyên vật liệu, Sản xuất, Vận chuyển, Bao bì).
   - **Số lượng SKU Quản lý:** Tổng danh mục sản phẩm đang theo dõi so với hạn mức gói thuê bao.
   - **Độ sẵn sàng Xuất khẩu Trung bình (% Avg Export Readiness):** Điểm sẵn sàng trung bình của các thị trường trọng điểm mà công ty đăng ký mục tiêu.
   - **Chỉ số Tin cậy Dữ liệu (% Data Confidence Score):** Đo lường mức độ tin cậy dựa trên tỷ lệ dữ liệu đo đạc trực tiếp (DQL L1/L2) so với dữ liệu ước tính thứ cấp.
2. **Biểu đồ Xu hướng & Mục tiêu Giảm phát thải (Emission Trends & Targets):** So sánh phát thải thực tế từng tháng (`actualEmissions`) với lộ trình mục tiêu (`targetEmissions`) theo chu kỳ 1 đến 12 tháng.
3. **Phân bổ Phát thải theo Công đoạn (Emission Breakdown):** Trực quan hóa tỷ trọng phát thải theo 4 nhóm (Nguyên vật liệu, Sản xuất, Bao bì, Vận tải), áp dụng thuật toán chia dư lớn nhất (Hamilton-Hare) để đảm bảo tổng phần trăm luôn bằng chính xác $100\%$.
4. **Xem trước Mức độ Sẵn sàng Thị trường (Market Readiness Preview):** Hiển thị top 3 thị trường mục tiêu hàng đầu với thanh tiến độ màu sắc (Xanh / Vàng / Đỏ) và phím tắt chuyển nhanh sang cổng xuất khẩu.
5. **Khuyến nghị Giảm phát thải Thông minh (Actionable Decarbonization Recommendations):** Gợi ý các hành động giảm phát thải ưu tiên cao kèm ước tính tỷ lệ cắt giảm carbon.

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/overview/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/overview/page.tsx): Route máy chủ nạp `OverviewPageClient`.
- [`Weavecarbon/components/dashboard/overview/OverviewPageClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/overview/OverviewPageClient.tsx): Giao diện tổng quan tương tác (thẻ KPI, bộ chọn chu kỳ xu hướng tháng, đồ thị phân bổ, danh sách sản phẩm phát thải cao nhất, khuyến nghị).
- [`Weavecarbon/components/dashboard/overview/overviewPageHelpers.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/overview/overviewPageHelpers.tsx): Định nghĩa kiểu dữ liệu, hằng số bảng màu và hàm chuẩn hóa hiển thị.
- [`Weavecarbon/components/dashboard/overview/overviewPageHelpers.test.ts`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/overview/overviewPageHelpers.test.ts): Bộ kiểm thử đơn vị frontend cho các hàm chuẩn hóa dữ liệu tổng quan.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/dashboard.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/dashboard.js): Router cung cấp `GET /api/dashboard/overview` và `POST /api/dashboard/targets`.
- [`BE_weavecarbon/src/services/dashboardService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/dashboardService.js): Service tổng hợp số liệu từ các bảng `products`, `shipments`, `compliance_market_documents`, áp dụng TTL cache đa khách thuê (`overviewCache`).
- [`BE_weavecarbon/src/utils/ttlCache.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/utils/ttlCache.js): Bộ đệm bộ nhớ đệm có thời hạn cô lập theo tenant.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Người dùng truy cập /overview]
       │
       ├─► 1. GET /api/dashboard/overview?trend_months=6
       ▼
[Backend: routes/dashboard.js]
       │
       ▼
[BE: dashboardService.js: getOverview(companyId, trendMonths)]
       ├─► Kiểm tra TTL Cache (`overviewCache` theo key `companyId:trendMonths`)
       │   └─► Nếu HIT: trả về ngay lập tức
       │
       ├─► Nếu MISS: Chạy truy vấn SQL tổng hợp:
       │      ├─► Tính tổng carbon từ bảng `products` (materials, production, packaging)
       │      ├─► Tính carbon logistics từ `shipments` & `shipment_products`
       │      │   (áp dụng quy tắc phân bổ: GREATEST(product.transport, shipment.allocated))
       │      ├─► Tính điểm sẵn sàng thị trường từ `compliance_market_documents`
       │      ├─► Phân bổ tỷ trọng và chạy thuật toán `normalizeBreakdownPercentages()`
       │      └─► Lưu kết quả vào Cache với TTL `READ_CACHE_TTL_MS`
       ▼
[Frontend: OverviewPageClient.tsx]
       └─► Hiển thị 4 Card KPI, Đồ thị Xu hướng, Biểu đồ Tròn và Bảng SKU phát thải cao nhất
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `products` & `shipments`: Dữ liệu phát thải gốc được tổng hợp động.
- Bảng `carbon_targets`: Định mức mục tiêu giảm phát thải tháng/năm do doanh nghiệp thiết lập.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-OVW-01** | Chu kỳ Xu hướng Tháng | `trend_months` phải là số nguyên từ 1 đến 12 tháng | `400 Bad Request` (`INVALID_PARAMETER`) |
| **CTL-OVW-02** | Bắt buộc Tenant Scope | Chỉ tổng hợp dữ liệu thuộc `req.companyId`, không trộn lẫn dữ liệu giữa các công ty | `404 Not Found` (`COMPANY_NOT_FOUND`) |
| **CTL-OVW-03** | Quy tắc Tròn Tỷ lệ 100% | Tổng 4 thành phần phân bổ phát thải bắt buộc phải bằng chính xác $100\%$ (sử dụng Largest Remainder Algorithm) | Tự động cân bằng làm tròn |
| **CTL-OVW-04** | Tránh Đếm Trùng Vận tải (Transport Non-Double-Counting) | Phát thải vận tải lấy giá trị lớn hơn giữa khai báo tĩnh của sản phẩm và phân bổ thực tế từ lô hàng | `GREATEST(product_transport, shipment_transport)` |
| **CTL-OVW-05** | Bộ Đệm TTL An Toàn | Cache được bọc bởi namespace tenant (`companyId`), tự động vô hiệu hóa khi có sự kiện cập nhật sản phẩm | Ngăn chặn rò rỉ dữ liệu giữa các tenant |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn truy cập:**
  - `OVERVIEW_VIEW`: Mọi vai trò được xác thực trong tổ chức (`admin`, `operator`, `auditor`, `viewer`) đều có thể xem bảng điều khiển tổng quan.
  - `OVERVIEW_SET_TARGET`: Chỉ Admin mới có quyền thiết lập mục tiêu giảm phát thải (`POST /api/dashboard/targets`).
- **Ranh giới Multi-Tenancy:**
  - Mọi câu truy vấn SQL bên trong `dashboardService.js` đều được neo chặt bởi tham số `$1 = companyId`.
  - Bộ đệm `overviewCache` sử dụng composite key kết hợp giữa mã công ty và khoảng thời gian, ngăn chặn hoàn toàn việc xem chéo số liệu.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Hiển thị nhất quán và hiện đại:** Thiết kế tiêu chuẩn cao với thẻ KPI có thanh tiến độ rõ ràng, số liệu làm tròn hợp lý kèm đơn vị ($tCO_2e$, SKU, %).
2. **Tương tác linh hoạt:** Người dùng có thể chuyển đổi nhanh khoảng thời gian phân tích xu hướng (3 tháng, 6 tháng, 12 tháng) mà không bị tải lại trang.
3. **Liên kết điều hướng thông minh (Deep Linking):** Từ danh sách thị trường xem trước hoặc danh mục SKU phát thải cao nhất, người dùng có thể nhấp chuột trực tiếp để chuyển sang màn hình chi tiết tương ứng (`/export` hoặc `/products/[id]`).

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế bảo vệ và tính toán số liệu tổng quan hoạt động ổn định.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Tự động xóa bộ đệm cache khi ghi nhận lô hàng mới:** Hiện tại `overviewCache` dựa chủ yếu vào thời gian hết hạn TTL (`READ_CACHE_TTL_MS`). Khi người dùng tạo một lô hàng lớn trong `/logistics`, số liệu trên Overview có thể bị trễ vài phút trừ khi người dùng chủ động làm mới hoặc cache được bắn tín hiệu invalidate chủ động từ event bus.

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Bổ sung nút xuất ảnh snapshot bảng điều khiển:** Thêm tính năng xuất toàn bộ bảng điều khiển tổng quan dạng file ảnh PNG hoặc PDF tóm tắt nhanh để gửi nhanh trong các cuộc họp giao ban ban giám đốc.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:** `BE_weavecarbon/tests/utils/ttlCache.test.js` (kiểm tra tính cô lập đa khách thuê và vòng đời bộ nhớ đệm dashboard).
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - **2/2 tests PASSED (100%)**
  - Đảm bảo cơ chế caching của Dashboard cô lập tuyệt đối giữa các tenant và hết hạn chính xác.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:** `Weavecarbon/components/dashboard/overview/overviewPageHelpers.test.ts`
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - **7/7 tests PASSED (100%)**
  - Kiểm tra các hàm chuẩn hóa danh mục phát thải, định dạng hiển thị KPI, giới hạn số lượng thị trường hiển thị và cơ chế bẫy lỗi gói dịch vụ.

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Hiển thị chính xác 4 thẻ KPI tổng hợp (Tổng phát thải, SKU, Độ sẵn sàng xuất khẩu, Độ tin cậy dữ liệu).
- [x] Đồ thị xu hướng thể hiện chính xác dữ liệu thực tế và đường mục tiêu giảm phát thải.
- [x] Tỷ lệ phần trăm phân bổ công đoạn phát thải luôn cộng lại bằng chính xác $100\%$.
- [x] Không xảy ra đếm trùng phát thải vận tải giữa sản phẩm và logistics lô hàng.
- [x] Đảm bảo cách ly đa khách thuê tuyệt đối trong bộ đệm và truy vấn cơ sở dữ liệu.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Tổng quan `/overview` là bức tranh tổng hòa hoàn chỉnh của toàn bộ nền tảng, liên kết dữ liệu từ Sản phẩm, Logistics, Tuân thủ xuất khẩu và Quản trị dữ liệu thành các chỉ số hành động trực quan cho ban lãnh đạo.
- **Biên giới chưa xác minh:** Khi cơ sở dữ liệu có hàng chục triệu bản ghi sản phẩm và vận đơn, truy vấn tổng hợp SQL cần được hỗ trợ thêm bằng Materialized Views định kỳ để duy trì thời gian phản hồi dưới 200ms khi bộ đệm cache hết hạn.
