# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 13: Xuất Khẩu & Tuân Thủ (/export)

> **Mã Phase:** PHASE-13  
> **Tên Module:** Cổng Thông tin Xuất khẩu, Tuân thủ Thị trường Quốc tế & Handoff Hải quan (Export Markets, Regulatory Compliance R01-R20, Customs Handoffs & Digital Product Passport Export)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/export/page.tsx`, `Weavecarbon/components/dashboard/export/ExportClient.tsx`, `ExportConfigurationPortalV2.tsx`, `ShipmentExportPortal.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/exportMarkets.js`, `BE_weavecarbon/src/routes/exportV2.js`, `BE_weavecarbon/src/services/exportMarketsService.js`, `BE_weavecarbon/src/services/exportShipmentService.js`, `BE_weavecarbon/src/services/complianceApplicabilityControls.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/export` là trung tâm điều hành tuân thủ chuỗi cung ứng xuất khẩu của doanh nghiệp sang các thị trường trọng điểm (EU, US, JP, KR, AU, ASEAN, VN, UK, CN, v.v.). Hệ thống chịu trách nhiệm:
1. **Đánh giá mức độ sẵn sàng tuân thủ (Market Readiness Scoring):** Tự động tính điểm phần trăm sẵn sàng (0-100%) của doanh nghiệp đối với từng thị trường dựa trên danh mục tài liệu bắt buộc (mandatory), tài liệu khuyến nghị (recommended) và chứng chỉ vật liệu xanh (GOTS, OEKO-TEX, GRS, FSC, BCI).
2. **Quy định chuyên ngành & Chế tài quốc tế (R01 - R20):** Quản lý hồ sơ kỹ thuật chuyên sâu theo tiêu chuẩn quốc tế:
   - **EU CBAM & ISO 14067:** Báo cáo dấu chân carbon sản phẩm (PCF Study).
   - **EU REACH SVHC:** Hồ sơ kiểm soát chất có nguy cơ cao (SVHC Dossier $\le 0.1\%$ w/w).
   - **EU GPSR:** Hồ sơ kỹ thuật an toàn sản phẩm chung (General Product Safety Regulation Technical File).
   - **Quy định nhãn sợi & EPR Dệt may EU (EU Textile Fibre Label & EPR):** Khai báo thành phần sợi, truy xuất nguồn gốc và nghĩa vụ trách nhiệm mở rộng nhà sản xuất.
   - **EU Green Claims Directive:** Sổ đăng ký công bố môi trường (Environmental Claim Register) chống tẩy xanh (anti-greenwashing).
3. **Cổng bàn giao Hải quan số (Digital Customs Handoffs):** Chuẩn bị gói dữ liệu thông quan điện tử tích hợp:
   - **VN Customs Handoff:** Bàn giao tờ khai VNACCS/VCIS.
   - **EU Import & ICS2 Handoff:** Hệ thống kiểm soát nhập khẩu hàng hóa vào EU.
   - **Origin Handoff:** Chứng nhận xuất xứ hàng hóa (C/O Form EUR.1, Form D, v.v.).
4. **Hộ chiếu sản phẩm số (DPP Lock & Audit Pack):** Khóa dữ liệu hộ chiếu sản phẩm kỹ thuật số (DPP Lock V2) với mã QR truy xuất và tải gói hồ sơ kiểm toán hoàn chỉnh (Audit Pack JSON/CSV/XLSX).

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/export/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/export/page.tsx): Route máy chủ Next.js App Router bọc `ExportClient`.
- [`Weavecarbon/components/dashboard/export/ExportClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/export/ExportClient.tsx): Giao diện tổng quan danh sách thị trường xuất khẩu, thẻ tiến độ, tài liệu tuân thủ theo nhóm (`export_compliance`, `material_certification`), và cổng cấu hình nâng cao.
- [`Weavecarbon/components/dashboard/export/ExportConfigurationPortalV2.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/export/ExportConfigurationPortalV2.tsx): Cổng cấu hình chuyên sâu DPP V2, tạo QR code, xem trước báo cáo carbon theo SKU, và xuất gói hồ sơ kiểm toán.
- [`Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx): Cổng quản lý giấy tờ lô hàng xuất khẩu cụ thể.
- Các Panel chuyên ngành:
  - `ComplianceApplicabilityPanel.tsx`: Bộ lọc ma trận áp dụng luật theo mã HS và quốc gia đích.
  - `ReachSvhcDossierPanel.tsx`: Khai báo nồng độ hóa chất SVHC.
  - `GpsrTechnicalFilePanel.tsx`: Hồ sơ an toàn người tiêu dùng EU.
  - `TextileFibreLabelPanel.tsx`: Tỷ lệ phối sợi dệt may.
  - `EnvironmentalClaimRegisterPanel.tsx`: Đăng ký công bố môi trường.
  - `PcfStudyPanel.tsx`: Dấu chân carbon sản phẩm theo đơn vị chức năng.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/exportMarkets.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/exportMarkets.js): Khai báo router danh mục thị trường, tài liệu tải lên, duyệt và tính điểm sẵn sàng.
- [`BE_weavecarbon/src/routes/exportV2.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/exportV2.js): API cấu hình xuất khẩu V2, khóa DPP và xuất audit pack.
- [`BE_weavecarbon/src/services/exportMarketsService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/exportMarketsService.js): Xử lý tính điểm readiness, chuẩn hóa mã tài liệu, khởi tạo dữ liệu mẫu các thị trường.
- [`BE_weavecarbon/src/services/complianceApplicabilityControls.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/complianceApplicabilityControls.js): Kiểm tra và dựng đánh giá quy định áp dụng; `exportShipmentService.js` lưu và truy xuất các evaluation/review theo lô hàng.
- Các module kiểm soát quy định chuyên ngành trong `BE_weavecarbon/src/services/`:
  - `euImportHandoffControls.js`, `ics2HandoffControls.js`, `vnCustomsHandoffControls.js`, `originHandoffControls.js`, `gpsrTechnicalFileControls.js`, `reachSvhcDossierControls.js`, `textileFibreLabelControls.js`, `euTextileEprControls.js`, `environmentalClaimControls.js`.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Người dùng / Doanh nghiệp xuất khẩu]
       │
       │ 1. Tải lên tài liệu tuân thủ (PDF) hoặc nhập dữ liệu kỹ thuật chuyên ngành
       ▼
[Frontend: ExportClient.tsx / Specialized Panels]
       │
       ├─► 2. Kiểm tra định dạng (chỉ chấp nhận PDF cho chứng chỉ), kiểm tra gói thuê bao (Standard/Enterprise)
       │
       ▼
[Backend: exportMarkets.js / exportV2.js]
       │
       ├─► 3. Lưu tài liệu vào Evidence Vault (S3/Local Storage)
       ├─► 4. exportMarketsService: Cập nhật trạng thái chứng từ (uploaded, approved)
       ├─► 5. Tính toán lại điểm Market Readiness Score:
       │      Score = (Approved Required Docs / Total Required Docs) * 100
       ├─► 6. complianceApplicabilityControls + exportShipmentService: Lập, lưu và truy xuất ma trận tuân thủ theo mã HS và thị trường đích
       └─► 7. Ký số & Khóa DPP (Digital Product Passport Lock V2)
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `compliance_market_documents`: Lưu vết các chứng chỉ đã nộp, trạng thái phê duyệt và thời hạn hiệu lực.
- Bảng `market_requirements`: Quy chuẩn danh mục hồ sơ bắt buộc của 16 thị trường được chuẩn hóa.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-EXP-01** | Giới hạn định dạng tệp | Chứng từ chứng nhận bắt buộc phải là PDF (`application/pdf`) | `400 Bad Request` (`ONLY_PDF_ALLOWED`) |
| **CTL-EXP-02** | Rào cản gói thuê bao (Paywall/Tier Gate) | Doanh nghiệp gói miễn phí (Free) không được truy cập tính năng xuất khẩu và tải báo cáo kiểm toán | `403 Forbidden` (`PLAN_RESTRICTED`, mở Pricing Modal) |
| **CTL-EXP-03** | Khóa bất biến DPP (DPP Lock V2) | Khi DPP đã được tạo chữ ký khóa (Locked), không cho phép chỉnh sửa trọng lượng carbon trừ khi mở khóa có log kiểm toán | `409 Conflict` (`DPP_ALREADY_LOCKED`) |
| **CTL-EXP-04** | Ngưỡng REACH SVHC | Khai báo tỷ lệ hóa chất thuộc danh mục SVHC không được vượt quá $0.1\%$ w/w mà không có hồ sơ cảnh báo an toàn kèm theo | Cảnh báo đỏ `SVHC_THRESHOLD_EXCEEDED` |
| **CTL-EXP-05** | Tính hợp lệ nhãn sợi Dệt may | Tổng tỷ lệ phần trăm các thành phần sợi trong `TextileFibreLabel` bắt buộc phải bằng chính xác $100\%$ | `422 Unprocessable Entity` (`FIBRE_PERCENTAGE_SUM_MUST_BE_100`) |
| **CTL-EXP-06** | Kiểm soát công bố môi trường (Anti-Greenwashing) | Mọi công bố nhãn sinh thái hoặc giảm phát thải phải liên kết với ít nhất một bằng chứng kiểm định độc lập cấp 3 (Third-party Verification) | `400 Bad Request` (`UNVERIFIED_ENVIRONMENTAL_CLAIM`) |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn cần thiết:**
  - `EXPORT_VIEW`: Xem danh mục thị trường, điểm readiness và quy định áp dụng.
  - `EXPORT_UPLOAD`: Tải lên chứng từ, khai báo chỉ số SVHC, nhãn sợi hoặc công bố môi trường.
  - `EXPORT_APPROVE`: Duyệt tài liệu tuân thủ nội bộ (Compliance Officer).
  - `EXPORT_ADMIN`: Thực hiện khóa DPP, bàn giao hồ sơ hải quan hoặc xuất khẩu gói kiểm toán Audit Pack.
- **Ranh giới Multi-Tenancy:**
  - Bảng `compliance_market_documents` và các hồ sơ kỹ thuật gắn chặt với `organizationId`.
  - Nghiêm cấm chia sẻ hoặc truy xuất chéo chứng nhận giữa các tổ chức khác nhau.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Giao diện đa thị trường mạnh mẽ:** Hỗ trợ 16 thị trường xuất khẩu với bản đồ màu trực quan thể hiện trạng thái sẵn sàng (xanh $\ge 80\%$, vàng $50-79\%$, đỏ $<50\%$).
2. **Tách biệt nhóm tài liệu rõ ràng:** Phân biệt rành mạch giữa `export_compliance` (hồ sơ hải quan, quy chuẩn thị trường) và `material_certification` (chứng chỉ vật liệu xanh như GOTS, OEKO-TEX).
3. **Bộ chuyển đổi mượt mà giữa Demo và Production:** Tự động hỗ trợ mock data cho chế độ Demo nhưng chuyển sang gọi API bảo mật nghiêm ngặt khi chạy trong dashboard chính thức.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế kiểm soát quyền và cô lập tenant đã được bao phủ toàn diện.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Đồng bộ ngày hết hạn chứng chỉ tự động:** Khi chứng chỉ vật liệu (ví dụ OEKO-TEX) hết hạn trong bảng `compliance_market_documents`, hệ thống chưa tự động hạ điểm readiness của thị trường liên quan cho đến khi người dùng chủ động tải lại trang hoặc có trigger quét nền định kỳ.

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Tích hợp bộ chuyển đổi HS Code thông minh:** Hỗ trợ gợi ý mã HS Code 6 số sang 8/10 số tự động khi doanh nghiệp xuất khẩu từ Việt Nam sang EU hoặc Hoa Kỳ (HTS Code).

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/services/exportMarketsService/*` (3 suites: seeding, marketRequirements, normalizers)
  - `BE_weavecarbon/tests/services/exportShipmentService.test.js`
  - `BE_weavecarbon/tests/services/exportDocumentPdf.test.js`
  - `BE_weavecarbon/tests/services/complianceApplicabilityControls.test.js`
  - `BE_weavecarbon/tests/services/complianceApplicabilityService.test.js`
  - 9 suites kiểm soát bàn giao & chế tài: `environmentalClaimControls.test.js`, `textileFibreLabelControls.test.js`, `euTextileEprControls.test.js`, `reachSvhcDossierControls.test.js`, `ics2HandoffControls.test.js`, `vnCustomsHandoffControls.test.js`, `originHandoffControls.test.js`, `euImportHandoffControls.test.js`, `gpsrTechnicalFileControls.test.js`.
- **Kết quả thực thi:**
  - **16/16 test suites PASSED (100%)**
  - **167/167 tests PASSED (100%)** (108 tests trong nhóm lõi thị trường + 59 tests trong nhóm bàn giao hải quan & chế tài quốc tế).

### 8.2. Frontend Tests
- **Tập tin kiểm thử:**
  - `components/dashboard/export/ReachSvhcDossierPanel.test.ts`
  - `components/dashboard/export/ComplianceApplicabilityPanel.test.ts`
  - `lib/weave-v2/shipmentExportApi.test.ts`
  - `components/dashboard/export/PcfStudyPanel.test.ts`
  - `components/dashboard/export/readiness.test.ts`
  - `components/dashboard/export/GpsrTechnicalFilePanel.test.ts`
  - `components/dashboard/export/TextileFibreLabelPanel.test.ts`
  - `components/dashboard/export/EnvironmentalClaimRegisterPanel.test.ts`
- **Kết quả thực thi:**
  - **8/8 test files PASSED (100%)**
  - **17/17 tests PASSED (100%)**

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Tính toán điểm Market Readiness Score chính xác theo tỷ lệ hồ sơ bắt buộc đã nộp/được duyệt.
- [x] Hỗ trợ tải lên và xác thực định dạng PDF cho các chứng chỉ tuân thủ xuất khẩu và vật liệu.
- [x] Áp dụng rào cản gói dịch vụ (Tier restriction) đúng chuẩn đối với tài khoản Free khi truy cập tính năng xuất khẩu nâng cao.
- [x] Kiểm soát chặt chẽ các quy định kỹ thuật chuyên ngành (tổng nhãn sợi $100\%$, ngưỡng SVHC $\le 0.1\%$, công bố môi trường có kiểm chứng).
- [x] Cung cấp cơ chế khóa bất biến DPP V2 và xuất khẩu gói kiểm toán Audit Pack đầy đủ dữ liệu.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Xuất khẩu & Tuân thủ có kiến trúc toàn diện và sâu rộng nhất trong hệ thống, bao phủ từ hồ sơ tuân thủ quy chuẩn quốc tế (EU CBAM, REACH, GPSR, EPR) đến bàn giao kỹ thuật số hải quan.
- **Biên giới chưa xác minh:** Việc tích hợp truyền nhận dữ liệu trực tiếp với hệ thống hải quan thực tế của nước nhập khẩu (như cổng API hải quan EU ICS2 hoặc Hải quan Việt Nam) hiện đang ở mức tạo payload bàn giao chuẩn (Handoff payload generation) chứ chưa ký kết nối trực tiếp với cổng API quốc gia (cần chữ ký số USB Token và kênh VPN chuyên dụng).
