# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 19: Báo Cáo (/reports)

> **Mã Phase:** PHASE-19  
> **Tên Module:** Trung Tâm Báo Cáo Carbon Đa Tiêu Chuẩn, Xuất Bản Biểu Mẫu PDF/XLSX/CSV & Hàng Đợi Tác Vụ Báo Cáo Nền (Multi-Standard Reporting Hub, R01-R20 Parity, Asynchronous Job Queue & Cross-Format Integrity)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/reports/page.tsx`, `Weavecarbon/app/(dashboard)/cbam-report/page.tsx`, `Weavecarbon/components/dashboard/reports/*`  
> **API Backend:** `BE_weavecarbon/src/routes/reports.js`, `BE_weavecarbon/src/modules/reports/*`, `BE_weavecarbon/src/services/reportsService.js`, `BE_weavecarbon/src/services/pdfReportService.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/reports` (kết hợp với route chuyển tiếp `/cbam-report`) là module tổng hợp đầu ra tối cao của toàn bộ hệ thống WeaveCarbon. Được xếp ở vị trí cuối cùng trong quy trình đánh giá (Phase 19 - Deferred/Last), module này có nhiệm vụ tổng hợp và đối soát chéo dữ liệu từ tất cả 18 phase trước:
1. **Tổng hợp Báo cáo Đa Chuẩn Quốc Tế & Quốc Gia (R01 - R20):**
   - **Báo cáo GHG Protocol Doanh nghiệp (Corporate GHG Inventory):** Kiểm kê Scope 1, Scope 2 (Location-based & Market-based), Scope 3 (15 Categories).
   - **Báo cáo EU CBAM (Regulation 2023/956):** Khai báo khí thải trực tiếp và gián tiếp của hàng hóa nhập khẩu vào EU (thép, xi măng, nhôm, phân bón), cấu trúc 6 bảng tính chi tiết.
   - **Báo cáo Dấu chân Carbon Sản phẩm (ISO 14067 / PCF Passport):** Hộ chiếu carbon sản phẩm theo đơn vị chức năng, phân rã theo 4 công đoạn (Vật liệu, Sản xuất, Vận chuyển, Bao bì).
   - **Báo cáo Trách nhiệm Mở rộng Nhà sản xuất Dệt may EU (EU Textile EPR):** Báo cáo phân loại sợi và tỷ lệ tái chế phục vụ nghĩa vụ đóng phí EPR tại thị trường châu Âu.
   - **Báo cáo MRV Việt Nam (Nghị định 06/2022/NĐ-CP & Quyết định 13/2024/QĐ-TTg):** Biểu mẫu kê khai phát thải theo lĩnh vực công thương/xây dựng gửi cơ quan quản lý nhà nước.
2. **Đồng nhất Đa Định dạng (Cross-Format Parity: PDF / XLSX / CSV):** Đảm bảo các chỉ số phát thải, tổng cộng, và bảng phân rã hoàn toàn đồng nhất về mặt số học giữa bản in PDF (vector PDF nhiều trang), bảng tính Excel (XLSX với công thức và format chuyên nghiệp) và tệp dữ liệu thô (CSV RFC 4180).
3. **Hàng Đợi Xử Lý Báo Cáo Bất Đồng Bộ (Asynchronous Report Job Queue):** Xử lý sinh báo cáo lớn (hàng ngàn SKU hoặc giao dịch) qua hàng đợi nền (`reportJobQueue`), cung cấp polling kiểm tra trạng thái (`pending` -> `processing` -> `completed` / `failed`) và liên kết tải tệp tạm thời bảo mật.
4. **Kiểm Soát Rào Cản Gói Thuê Bao (Subscription Tier Paywall):** Doanh nghiệp gói Trial chỉ được tải báo cáo PDF thử nghiệm cơ bản; xuất toàn bộ tệp Excel có công thức hoặc gói kiểm toán bắt buộc phải nâng cấp lên Standard hoặc Export.

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/reports/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/reports/page.tsx): Route chính quản lý trung tâm báo cáo.
- [`Weavecarbon/app/(dashboard)/cbam-report/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/cbam-report/page.tsx): Route tiền kiểm toán CBAM (chuyển tiếp và tích hợp tab CBAM trong reports).
- [`Weavecarbon/components/dashboard/reports/ReportClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/reports/ReportClient.tsx): Giao diện tương tác chính (lọc theo 4 nhóm báo cáo: ESG, GHG, CBAM, ISO; bộ đếm nguồn dữ liệu; xem trước dữ liệu và nút xuất tải).
- [`Weavecarbon/components/dashboard/reports/ReportPreviewModal.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/reports/ReportPreviewModal.tsx): Modal xem trước nội dung báo cáo trước khi quyết định tải về.
- Các Panel nghiệp vụ chuyên biệt:
  - `CorporateGhgInventoryPanel.tsx`: Bảng điều khiển kiểm kê GHG doanh nghiệp.
  - `EuTextileEprPanel.tsx`: Bảng điều khiển EPR Dệt may EU.
  - `CbamReportSection.tsx`: Bảng kê hóa đơn, phát thải trực tiếp/gián tiếp theo chuẩn CBAM.
- Các bộ sinh tài liệu phía client trong `Weavecarbon/lib/reports/`:
  - `standardReportPdf.ts`, `standardReportXlsx.ts`, `cbamTemplate.ts`, `productCarbonTemplate.ts`, `tradeDocumentsXlsx.ts`, `csv.ts`, `excelTheme.ts`.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/reports.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/reports.js): Router cung cấp các API lấy dữ liệu báo cáo, tạo job xuất nền và tải tệp kết quả.
- [`BE_weavecarbon/src/modules/reports/index.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/modules/reports/index.js): Module trung tâm tổng hợp dịch vụ báo cáo, đóng gói bundle và hàng đợi tác vụ.
- [`BE_weavecarbon/src/services/reportsService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/reportsService.js): Service trích xuất dữ liệu, định dạng số học và kiểm tra điều kiện xuất.
- [`BE_weavecarbon/src/services/pdfReportService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/pdfReportService.js): Bộ tạo tài liệu PDF từ phía backend.
- [`BE_weavecarbon/src/services/reportJobQueue.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/reportJobQueue.js): Hàng đợi tác vụ sinh báo cáo chạy nền.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Người dùng chọn loại báo cáo (GHG / CBAM / PCF / EPR) & Định dạng (PDF / XLSX / CSV)]
       │
       ▼
[Frontend: ReportClient.tsx]
       │
       ├─► Kiểm tra gói dịch vụ (Standard/Export vs Free/Trial)
       │
       ├─► Trường hợp A: Báo cáo dung lượng vừa / Client-side generation:
       │      ├─► Gọi API trích xuất dữ liệu: GET /api/reports/datasets/:type
       │      ├─► Dựng bảng tính hoặc PDF bằng thư viện chuyên dụng
       │      │   (XLSX / PDF-lib / Papaparse)
       │      └─► Kích hoạt tải tệp trực tiếp trên trình duyệt
       │
       └─► Trường hợp B: Báo cáo nặng / Asynchronous Job:
              ├─► POST /api/reports/jobs { reportType, filters, format }
              ├─► Backend đưa tác vụ vào `reportJobQueue`
              ├─► Worker chạy ngầm: tập hợp dữ liệu -> sinh tệp -> lưu vào Storage tạm
              ├─► Frontend poll trạng thái: GET /api/reports/jobs/:jobId
              └─► Khi Status = 'completed', nhận `downloadUrl` có chữ ký thời hạn
```

**Nguồn sự thật (Single Source of Truth):**
- Tổng hợp từ tất cả các bảng dữ liệu nền tảng: `products`, `shipments`, `evidence_files`, `compliance_market_documents`, `activity_logs`, `corporate_ghg_inventories`.
- Bảng `report_jobs`: Nguồn sự thật về trạng thái xử lý các yêu cầu xuất báo cáo bất đồng bộ.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-REP-01** | Quyền Xuất Dữ liệu Nâng cao | Khách hàng gói Free không được phép tải tệp Excel (.xlsx) đầy đủ hoặc Audit Pack | `403 Forbidden` (`PLAN_RESTRICTED`, mở Pricing Modal) |
| **CTL-REP-02** | Toàn vẹn Dữ liệu Số học (Data Integrity) | Các ô tính số liệu phát thải trong Excel bắt buộc lưu dưới dạng số thực (`number`), không được lưu dạng text; tổng các cột phải bằng tổng các hàng | Kiểm thử tự động `excelTheme.test.ts` |
| **CTL-REP-03** | Tính Đồng nhất Đa Định dạng (Cross-Format Parity) | Tổng phát thải trên PDF, XLSX và CSV phải khớp chính xác tuyệt đối (dung sai sai số làm tròn $\le 0.001$) | Kiểm thử tự động `crossFormat.test.ts` |
| **CTL-REP-04** | Xử lý Dữ liệu Rỗng & Biên Cực đại | Khi công ty chưa có dữ liệu sản phẩm, báo cáo vẫn phải tạo đủ các sheet tiêu chuẩn với giá trị 0 an toàn; hỗ trợ tải đến 2,000 dòng không nghẽn bộ nhớ | Kiểm thử tự động `reportEdgeCases.test.ts` |
| **CTL-REP-05** | Hàng đợi Tác vụ Báo cáo Nền | Job báo cáo chạy quá thời gian chờ (Timeout 5 phút) phải tự động đánh dấu `failed` và giải phóng tài nguyên worker | Cơ chế tự phục hồi trong `jobQueue.test.js` |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn truy cập:**
  - `REPORTS_VIEW`: Cho phép xem trước số liệu tóm tắt và biểu đồ báo cáo.
  - `REPORTS_EXPORT_BASIC`: Tải báo cáo PDF tóm tắt hoặc CSV danh mục sản phẩm.
  - `REPORTS_EXPORT_COMPREHENSIVE`: Khởi tạo job xuất toàn bộ hồ sơ kiểm toán GHG/CBAM/EPR (yêu cầu vai trò Admin hoặc Compliance Officer trên gói trả phí).
- **Ranh giới Multi-Tenancy:**
  - Toàn bộ các truy vấn gom dữ liệu báo cáo đều áp dụng bộ lọc `company_id = req.companyId`.
  - Tệp báo cáo được sinh ra trong thư mục lưu trữ cô lập riêng cho từng công ty và liên kết tải về có chữ ký thời hạn tạm thời (Signed URL hết hạn sau 15 phút).

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Bộ phân loại báo cáo chuẩn mực:** 4 thẻ nhóm lớn (ESG, GHG Protocol, EU CBAM, ISO 14067) giúp người dùng dễ dàng định vị tài liệu theo đúng chuẩn mực mà đối tác hoặc cơ quan thẩm quyền yêu cầu.
2. **Xem trước minh bạch (Report Preview Modal):** Cho phép người dùng duyệt qua dữ liệu mẫu, cấu trúc sheet và các trường thông tin trước khi nhấn nút tải về, tránh việc tải nhầm tệp dữ liệu rỗng.
3. **Giao diện phản hồi trạng thái tải mượt mà:** Đối với các báo cáo lớn, thanh tiến độ và thông báo toast cập nhật trạng thái xử lý từng bước (`Đang tạo tệp...` -> `Hoàn tất, đang tải xuống...`), nâng cao trải nghiệm người dùng.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế xuất báo cáo đạt chuẩn bảo mật và kiểm thử toàn diện cả về tính toàn vẹn số học và cô lập dữ liệu.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Tự động dọn dẹp các tệp báo cáo tạm thời:** Hiện tại các file báo cáo sinh ra bởi worker nền được lưu trên đĩa tạm; cần bổ sung cron job tự động dọn dẹp (cleanup garbage collector) các tệp có tuổi thọ quá 24 giờ để tránh làm đầy dung lượng ổ đĩa máy chủ.

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Lưu mẫu báo cáo tùy chỉnh (Saved Report Templates):** Cho phép doanh nghiệp lưu lại bộ lọc thường dùng (ví dụ: chỉ xuất sản phẩm xuất khẩu sang Đức trong Quý 3) thành template yêu thích để tái sử dụng chỉ với 1 click.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/modules/reports/service.test.js`
  - `BE_weavecarbon/tests/modules/reports/jobQueue.test.js`
  - `BE_weavecarbon/tests/modules/reports/compatibility.test.js`
  - `BE_weavecarbon/tests/services/reportsService/helpers.test.js`
- **Kết quả thực thi:**
  - **4/4 test suites PASSED (100%)**
  - **27/27 tests PASSED (100%)**
  - Kiểm tra hàng đợi tác vụ nền, khả năng tương thích ngược, xử lý bất đồng bộ và các hàm trợ giúp trích xuất số liệu.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:**
  - `Weavecarbon/lib/reports/standardReportXlsx.test.ts`
  - `Weavecarbon/lib/reports/reportStructure.test.ts`
  - `Weavecarbon/lib/reports/reportEdgeCases.test.ts`
  - `Weavecarbon/lib/reports/productCarbonTemplate.test.ts`
  - `Weavecarbon/lib/reportsApi.test.ts`
  - `Weavecarbon/lib/reports/crossFormat.test.ts`
  - `Weavecarbon/lib/reports/formTemplate.test.ts`
  - `Weavecarbon/lib/reports/tradeDocumentsXlsx.test.ts`
  - `Weavecarbon/lib/reports/standardReportPdf.test.ts`
  - `Weavecarbon/lib/reports/cbamTemplate.test.ts`
  - `Weavecarbon/lib/reports/excelTheme.test.ts`
  - `Weavecarbon/lib/weave-v2/reportBuilder.test.ts`
  - `Weavecarbon/lib/reports/csv.test.ts`
  - `Weavecarbon/components/dashboard/reports/CorporateGhgInventoryPanel.test.ts`
  - `Weavecarbon/components/dashboard/reports/EuTextileEprPanel.test.ts`
- **Kết quả thực thi:**
  - **15/15 test files PASSED (100%)**
  - **49/49 tests PASSED (100%)**
  - Khẳng định tính toàn vẹn cấu trúc mẫu (Golden template structures), đối soát đồng nhất đa định dạng (cross-format parity) và kiểm thử các ca biên cực đại (edge cases: rỗng và 2,000 dòng).

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Xuất bản chính xác đầy đủ các bộ báo cáo chuẩn mực: GHG Protocol, EU CBAM, ISO 14067 PCF, EU Textile EPR và MRV Việt Nam.
- [x] Đạt tính đồng nhất số học tuyệt đối giữa các tệp xuất PDF, Excel (XLSX) và CSV.
- [x] Các ô giá trị số trong bảng tính Excel lưu ở dạng number thuần túy và tính toán chính xác bằng công thức.
- [x] Hàng đợi tác vụ báo cáo nền (`reportJobQueue`) hoạt động ổn định, có cơ chế polling và bẫy lỗi timeout.
- [x] Áp dụng rào cản gói dịch vụ (Subscription Tier Gate) chính xác, bảo vệ quyền lợi thương mại của nền tảng.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Báo Cáo `/reports` hoàn thành xuất sắc vai trò "cửa sổ xuất xưởng" của toàn bộ giải pháp WeaveCarbon, cung cấp cho doanh nghiệp các bộ hồ sơ kiểm toán carbon và báo cáo tuân thủ quốc tế với độ chính xác và tính thẩm mỹ cao nhất.
- **Biên giới chưa xác minh:** Định dạng tệp XML chính thức theo cổng khai báo của Ủy ban châu Âu (EU CBAM Transitional Registry XML Schema) hiện đang được xuất ở dạng Excel template tiêu chuẩn. Cần hoàn tất bộ ánh xạ XSD sang XML trực tiếp khi EU công bố thông số cổng API hải quan chính thức cho kỳ áp dụng bắt buộc (Definitive Period 2026).
