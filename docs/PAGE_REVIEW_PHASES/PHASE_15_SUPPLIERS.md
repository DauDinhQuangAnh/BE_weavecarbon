# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 15: Nhà Cung Cấp (/suppliers)

> **Mã Phase:** PHASE-15  
> **Tên Module:** Mạng Lưới Nhà Cung Ứng, Giảm Phát Thải Phạm Vi 3 & Đánh Giá Tính Trọng Yếu Khí Hậu (Supplier Network, Scope 3 Decarbonization, Climate Hazard & Multi-Factor Criticality)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/suppliers/page.tsx`, `Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/suppliers.js`, `BE_weavecarbon/src/routes/supplierNetwork.js`, `BE_weavecarbon/src/services/supplierNetworkControls.js`, `BE_weavecarbon/src/services/supplierNetworkService.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/suppliers` và không gian quản trị mạng lưới nhà cung cấp (Supplier Network) là mắt xích trung tâm giải quyết bài toán phát thải gián tiếp trong chuỗi giá trị (Scope 3 Category 1 - Purchased Goods & Services) và quản trị rủi ro khí hậu chuỗi cung ứng theo IFRS S2 / TCFD. Các trụ cột nghiệp vụ bao gồm:
1. **Quản lý Yêu cầu & Thu thập Dữ liệu (Supplier Data Requests):** Tạo và gửi yêu cầu thu thập dữ liệu năng lượng, xuất xứ nguyên vật liệu, hệ số phát thải theo vòng đời đến từng đối tác cung ứng; theo dõi tiến độ phản hồi qua các trạng thái `draft`, `sent`, `waiting`, `received`, `overdue`.
2. **Hồ sơ Phân cấp & Địa điểm Nhà cung cấp (Profiles & Sites):** Quản lý hồ sơ nhà cung cấp Tier 1 – Tier 4, mã định danh pháp lý, quốc gia hoạt động; lưu trữ tọa độ địa lý các nhà máy phụ trợ với độ chính xác 6 chữ số thập phân (`precisionMeters` 1–100,000m) để ánh xạ rủi ro thiên tai.
3. **Mối quan hệ & Mức độ Phụ thuộc (Relationships & Spend/Dependency):** Phân tích tỷ lệ chi tiêu (`spendPercent`), mức độ phụ thuộc năng lực sản xuất (`productionDependencyPercent`), cờ nguồn cung độc quyền (`singleSource`), số lượng SKU và tuyến vận tải bị ảnh hưởng.
4. **Đánh giá Rủi ro Khí hậu Nhà cung cấp (Supplier Climate Assessment):** Kết hợp mô hình tái phân tích ERA5-Land (dữ liệu lịch sử) và mô phỏng khí hậu CMIP6 (kịch bản tương lai) để chấm điểm mức độ phơi nhiễm (Exposure) và độ nhạy cảm (Vulnerability) của từng cơ sở cung ứng.
5. **Mô hình Trọng yếu Tổng hợp (Criticality Portfolios):** Tổng hợp ma trận trọng yếu với bộ trọng số chuẩn hóa: Carbon ($35\%$), Khí hậu ($35\%$), Mức độ phụ thuộc sản xuất ($30\%$), phân loại nhà cung cấp theo các mức độ rủi ro (Low / Medium / High).
6. **Cổng kiểm soát bằng chứng (Evidence Gate):** Mọi bản ghi hồ sơ, cơ sở sản xuất hay đánh giá trọng yếu đều bắt buộc liên kết với một chứng từ minh chứng đã khóa (`evidenceDocumentId` UUID hợp lệ, băm SHA-256 64 ký tự và kích thước tệp $> 0$).

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/suppliers/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/suppliers/page.tsx): Route chính quản lý yêu cầu nhà cung cấp (bảng theo dõi email, hạn chót, trạng thái phản hồi).
- [`Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.tsx): Bảng điều khiển chuyên sâu quản trị mạng lưới nhà cung ứng đa tầng (hồ sơ, điểm đo, phụ thuộc, phân tích khí hậu, mô hình trọng yếu và danh mục đầu tư).
- [`Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.test.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.test.tsx): Bộ kiểm thử đơn vị frontend cho giao diện Supplier Network.
- [`Weavecarbon/lib/supplierNetworkApi.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/supplierNetworkApi.ts): Thư viện gọi API backend cho mạng lưới nhà cung ứng.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/suppliers.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/suppliers.js): Router xử lý CRUD yêu cầu thu thập dữ liệu từ nhà cung cấp.
- [`BE_weavecarbon/src/routes/supplierNetwork.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/supplierNetwork.js): Router quản lý hồ sơ, địa điểm, quan hệ, mô hình và danh mục trọng yếu chuỗi cung ứng.
- [`BE_weavecarbon/src/services/supplierNetworkControls.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/supplierNetworkControls.js): Module kiểm soát nghiệp vụ: kiểm tra tọa độ 6 chữ số thập phân, tỷ lệ phần trăm 0-100 (tối đa 3 chữ số thập phân), cổng bắt buộc bằng chứng UUID.
- [`BE_weavecarbon/src/services/supplierNetworkService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/supplierNetworkService.js): Xử lý lưu vết phiên bản bất biến (immutable revisions) và tính toán điểm trọng yếu.
- Database Migrations: Các bảng `supplier_requests`, `supplier_profiles`, `supplier_sites`, `supplier_relationships`, `supplier_climate_assessments`, `carbon_criticality_snapshots`, `criticality_models`, `criticality_snapshots`, `criticality_portfolios`.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Nhà cung cấp / Doanh nghiệp B2B]
       │
       ├─► 1. Gửi Supplier Request (Tên, Email, Loại vật liệu, Hạn chót)
       │
       ▼
[BE: routes/suppliers.js] ──► Lưu bảng `supplier_requests` (Status: draft -> sent)
       │
       │ Phân tích Chuyên sâu (Advanced Supplier Network):
       ├─► 2. Khởi tạo Profile (Tier 1-4, Country) + Gắn Evidence Document đã khóa
       ├─► 3. Đăng ký Site (Tọa độ WGS84 chính xác 6 số thập phân)
       ├─► 4. Xác lập Relationship (Spend %, Dependency %, Single Source flag)
       ├─► 5. Chạy đánh giá Khí hậu (ERA5-Land / CMIP6 Hazards)
       ├─► 6. Tính Snapshot Carbon Scope 3 (kgCO2e/unit, DQL L1-L5)
       │
       ▼
[BE: supplierNetworkService.js: createCriticalitySnapshot()]
       │
       ├─► Áp dụng Criticality Model (Carbon 35% + Climate 35% + Dependency 30%)
       ├─► Chuẩn hóa điểm 0 - 100 & Gán xếp hạng Low / Medium / High
       └─► Lưu bất biến vào `criticality_snapshots` và `criticality_portfolios`
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `supplier_requests`: Quản lý luồng tương tác và thu thập thông tin trực tiếp từ đối tác.
- Chuỗi phiên bản `supplier_*_revisions`: Nguồn sự thật kỹ thuật có chữ ký bằng chứng về chuỗi cung ứng xanh và rủi ro vật lý.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-SUP-01** | Bắt buộc Email & Tên đối tác | Yêu cầu nhà cung ứng phải có tên và định dạng email hợp lệ | `400 Bad Request` (`NAME_AND_EMAIL_REQUIRED`) |
| **CTL-SUP-02** | Độ chính xác Tọa độ Cơ sở | Tọa độ `latitude` (-90 đến 90), `longitude` (-180 đến 180) có tối đa 6 chữ số thập phân | `422 Unprocessable Entity` (`COORDINATES_PRECISION_LIMIT`) |
| **CTL-SUP-03** | Giới hạn Tỷ lệ Phụ thuộc | `spendPercent` và `productionDependencyPercent` phải từ $0.000\%$ đến $100.000\%$ (tối đa 3 chữ số thập phân) | `400 Bad Request` (`PERCENTAGE_OUT_OF_RANGE`) |
| **CTL-SUP-04** | Cổng Bằng chứng Đã khóa (Evidence Gate) | Mọi sửa đổi hồ sơ, điểm đo, quan hệ hoặc mô hình trọng yếu đều bắt buộc phải cung cấp `evidenceDocumentId` dạng UUID | `400 Bad Request` (`EVIDENCE_UUID_REQUIRED`) |
| **CTL-SUP-05** | Phân bổ Trọng số Mô hình Trọng yếu | Tổng trọng số $\text{carbonWeightPercent} + \text{climateWeightPercent} + \text{dependencyWeightPercent}$ phải bằng chính xác $100\%$ | `422 Unprocessable Entity` (`WEIGHTS_SUM_MUST_EQUAL_100`) |
| **CTL-SUP-06** | Phân tầng Ngưỡng Rủi ro | Ngưỡng rủi ro trung bình (`mediumThreshold`) phải nhỏ hơn ngưỡng rủi ro cao (`highThreshold`) | `400 Bad Request` (`INVALID_RISK_THRESHOLDS`) |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn cần thiết:**
  - `SUPPLIERS_VIEW`: Xem danh sách yêu cầu và bản đồ mạng lưới nhà cung ứng.
  - `SUPPLIERS_CREATE_REQUEST`: Tạo và kích hoạt gửi email yêu cầu dữ liệu.
  - `SUPPLIERS_NETWORK_ADMIN`: Cấu hình mô hình trọng yếu, phê duyệt hồ sơ địa điểm và gán bằng chứng kiểm định.
- **Ranh giới Multi-Tenancy:**
  - Mọi thao tác truy vấn đều bắt buộc có điều kiện `company_id = req.companyId`.
  - Nghiêm cấm chia sẻ thông tin giá trị thu mua, tỷ lệ chi tiêu (`spendPercent`) hoặc địa điểm nhà cung cấp giữa các khách hàng khác nhau.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Kết hợp hài hòa giữa cơ bản và nâng cao:** Giao diện cho phép người dùng phổ thông quản lý đơn giản các yêu cầu gửi qua email (ở đầu trang), đồng thời cung cấp không gian `SupplierNetworkPanel` cực kỳ mạnh mẽ cho chuyên viên ESG phân tích rủi ro khí hậu chuỗi cung ứng.
2. **Bộ lọc trạng thái phản hồi trực quan:** Sử dụng màu sắc tiêu chuẩn để biểu thị tiến độ (Xanh lá: đã nhận, Vàng: đang chờ, Đỏ: quá hạn phản hồi).
3. **Minh bạch cơ chế bằng chứng:** Lựa chọn chứng từ đính kèm được lọc tự động chỉ hiển thị các tệp đã khóa (`status: locked`) và có mã băm SHA-256 hợp lệ, giúp người dùng không thể vô tình gán tệp rác.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế bảo vệ và cách ly tenant Scope 3 hoạt động chặt chẽ.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Tự động kích hoạt cờ `overdue` theo thời gian thực:** Hiện tại trạng thái `overdue` chỉ được tính toán khi tải lại dữ liệu mà chưa có webhook hoặc cron job chạy hàng đêm để tự động chuyển trạng thái và gửi email nhắc nhở nhà cung ứng khi quá hạn chót (`deadline`).

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Bản đồ địa lý hóa chuỗi cung ứng (Supply Chain Geo Map):** Bổ sung trực quan hóa bản đồ vệ tinh (Leaflet/Mapbox) cho các điểm cơ sở nhà cung cấp để đối chiếu trực quan với vùng bão lũ hoặc nắng nóng cực đoan.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/services/supplierNetworkControls.test.js`
  - `BE_weavecarbon/tests/services/supplierNetworkService.test.js`
  - `BE_weavecarbon/tests/config/supplierNetworkMigrationContract.test.js`
  - `BE_weavecarbon/tests/modules/suppliersCompliance/service.test.js`
- **Kết quả thực thi:**
  - **4/4 test suites PASSED (100%)**
  - **15/15 tests PASSED (100%)**
  - Bao gồm: kiểm thử tính hợp lệ của profile/site/relationship, logic tính điểm trọng yếu tổng hợp, xác minh migration hợp đồng dữ liệu và dịch vụ tuân thủ nhà cung ứng.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:** `Weavecarbon/components/dashboard/suppliers/SupplierNetworkPanel.test.tsx`
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - **3/3 tests PASSED (100%)**
  - Kiểm tra render bảng điều khiển mạng lưới nhà cung ứng, binding form dữ liệu và lựa chọn bằng chứng.

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Tạo và quản lý vòng đời yêu cầu dữ liệu nhà cung ứng đầy đủ các trạng thái (`draft` -> `sent` -> `waiting` -> `received` / `overdue`).
- [x] Hỗ trợ cấu hình mạng lưới nhà cung ứng đa tầng với tọa độ địa lý chuẩn 6 số thập phân.
- [x] Kiểm soát tỷ lệ phụ thuộc sản xuất và chi tiêu trong ngưỡng $0 - 100\%$.
- [x] Áp dụng Evidence Gate nghiêm ngặt (bắt buộc UUID chứng từ đã khóa cho mọi hành động cập nhật hồ sơ).
- [x] Tính toán chính xác ma trận trọng yếu chuỗi cung ứng kết hợp Carbon, Khí hậu và Mức độ Phụ thuộc.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Nhà Cung Cấp `/suppliers` là công cụ cốt lõi giải quyết bài toán khó khăn nhất của kiểm kê carbon doanh nghiệp (Scope 3 Category 1), với khả năng quản lý chuyên nghiệp từ thu thập dữ liệu thô đến mô hình hóa rủi ro khí hậu chuỗi cung ứng.
- **Biên giới chưa xác minh:** Kênh tiếp nhận dữ liệu từ phía đối tác nhà cung ứng hiện tại dựa trên gửi email mời và portal độc lập. Cần đánh giá độ an toàn mã hóa của liên kết điền dữ liệu nhà cung ứng (Magic Link Token) khi mở rộng ra hàng ngàn nhà cung cấp quốc tế.
