# Phase 11 - Rà soát trang Rủi ro khí hậu (Climate Risk)

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Đánh giá Rủi ro Khí hậu Vật lý (TCFD / IFRS S2 - G2-07) |
| Route frontend chính | `/climate-risk` |
| Route demo tương ứng | `/demo/climate-risk` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | HIGH (Hoàn tất Bản đồ GIS tương tác, EvidenceSelector, Ma trận TCFD 5x5, Xuất hồ sơ CSV/JSON) |
| Thay đổi code trong phase | Đã triển khai GisCoordinateMap, EvidenceSelector, 5x5 Heatmap Matrix, Dossier Export và role gating |

---

## 2. Mục đích thực tế của trang

Trang `/climate-risk` phục vụ việc sàng lọc và đánh giá rủi ro vật lý do biến đổi khí hậu (Physical Climate Risk Screening) đối với mạng lưới cơ sở sản xuất và tài sản của doanh nghiệp theo khung chuẩn quốc tế **TCFD** và **IFRS S2**:

1. **Định vị GIS và độ chính xác cơ sở (Location Revision):**
   - Lưu trữ tọa độ địa lý chính xác (`latitude`, `longitude` đến 6 chữ số thập phân) và sai số định vị (`precisionMeters` từ 1m đến 100km).
   - Ràng buộc bằng chứng thực địa (`locationBasis` và `evidenceDocumentId`).
2. **Đánh giá hiểm họa khí hậu chuyên sâu (Hazard Assessment):**
   - Hỗ trợ 3 nhóm hiểm họa cấp bách: Nắng nóng cực đoan (`heat`), Hạn hán (`drought`), Mưa cực đoan / Ngập lụt (`extreme_rainfall`).
   - Phân biệt chặt chẽ giữa số liệu lịch sử (`historical`) và kịch bản dự báo tương lai (`projection`).
   - Tích hợp chuẩn nguồn dữ liệu khí tượng toàn cầu: **ERA5-Land** cho dữ liệu lịch sử và **CMIP6** cho mô hình dự báo biến đổi khí hậu (với tên mô hình `modelName`, kịch bản phát thải `scenarioName` như SSP2-4.5, SSP5-8.5).
   - Chấm điểm Mức độ phơi nhiễm (`exposureRating` 1–5), Mức độ dễ bị tổn thương (`vulnerabilityRating` 1–5), Tỷ lệ phụ thuộc kinh doanh (`businessDependencyPercent` 0–100%) và Phân dải ưu tiên (`priorityBand`: `low`, `medium`, `high`).
3. **Quản lý Danh mục Rủi ro (Portfolio Snapshot):**
   - Tập hợp từ 2 đến 100 đánh giá hiểm họa thành một hồ sơ rủi ro danh mục hoàn chỉnh có ghi chú phương pháp luận và lưu trữ mã băm SHA-256 bất biến.

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/climate-risk/page.tsx`
- `Weavecarbon/components/dashboard/climate-risk/ClimateRiskClient.tsx`
- `Weavecarbon/components/dashboard/climate-risk/ClimateRiskClient.test.tsx`
- `Weavecarbon/lib/climateRiskApi.ts`
- `Weavecarbon/lib/industrialCoreApi.ts`
- `Weavecarbon/lib/weave-v2/evidenceV2Api.ts`

### Backend
- `BE_weavecarbon/src/routes/climateRisk.js`
- `BE_weavecarbon/src/services/climateRiskService.js`
- `BE_weavecarbon/src/services/climateRiskControls.js`
- `BE_weavecarbon/migrations/045_g2_climate_risk_screening.sql`
- Tests:
  - `BE_weavecarbon/tests/services/climateRiskControls.test.js`
  - `BE_weavecarbon/tests/services/climateRiskService.test.js`
  - `BE_weavecarbon/tests/config/climateRiskMigrationContract.test.js`

### Database & Bảng dữ liệu
- Bảng `climate_locations`: lưu tọa độ cơ sở, độ chính xác m, nguồn gốc định vị, chứng từ và băm SHA-256.
- Bảng `climate_assessments`: lưu đánh giá hiểm họa, loại nguồn ERA5/CMIP6, độ phân giải không gian/thời gian, giá trị chỉ số hiểm họa, điểm phơi nhiễm, tổn thương, tỷ lệ phụ thuộc kinh doanh và băm SHA-256.
- Bảng `climate_portfolios`: lưu danh mục rủi ro, danh sách ID đánh giá và ghi chú phương pháp luận.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Quy chuẩn khoa học dữ liệu khí hậu (`climateRiskControls.js`)
- **Ràng buộc tương thích giữa Loại kịch bản và Nguồn dữ liệu:**
  Backend kiểm tra quy tắc vật lý nghiêm ngặt:
  ```js
  if ((value.scenarioKind === 'historical' && value.sourceKind === 'CMIP6') || 
      (value.scenarioKind === 'projection' && value.sourceKind === 'ERA5_LAND')) {
    errors.push('sourceKind does not match the scenario kind.');
  }
  ```
  Ngăn chặn việc gán dữ liệu dự báo CMIP6 cho mốc lịch sử hoặc dùng dữ liệu tái phân tích quá khứ ERA5-Land làm dự báo tương lai.
- **Bắt buộc liên kết nguồn HTTPS minh bạch:** `sourceUrl` bắt buộc phải là đường dẫn HTTPS hợp lệ trỏ tới kho dữ liệu của Copernicus CDS hoặc IPCC DDC.
- **Tọa độ GIS chuẩn hóa:** Tọa độ kinh độ (-180 đến 180) và vĩ độ (-90 đến 90) được kiểm soát tối đa 6 chữ số thập phân (độ phân giải tương đương ~0.11m).

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Location | Chọn Cơ sở sản xuất | Lấy từ `facilities` của Industrial Core. | Hoạt động tốt. |
| Location | Nhập Vĩ độ & Kinh độ | Input số thập phân step 0.000001. | Đúng chuẩn; nhưng **thiếu bản đồ click chọn điểm**. |
| Location | Ô "Tài liệu chứng minh" | Text input bắt gõ UUID. | **P0: Khó thao tác cho người dùng.** |
| Location | Nút "Lưu tọa độ định vị" | Gọi `POST /api/climate-risk/locations`. | Hoạt động tốt, kiểm tra số nguyên precision m. |
| Assessment | Form đánh giá hiểm họa | Chọn loại hiểm họa, nguồn ERA5/CMIP6, nhập metric, exposure (1-5), vulnerability (1-5). | Rất chặt chẽ và chuẩn hóa khoa học. |
| Assessment | Ô "Tài liệu chứng minh" | Text input bắt gõ UUID. | **P0: Khó thao tác cho người dùng.** |
| Assessment | Nút "Tạo đánh giá hiểm họa" | Gọi `POST /api/climate-risk/assessments`. | Hoạt động chính xác, sinh hash SHA-256. |
| Portfolio | Chọn các đánh giá hiểm họa | Checkbox chọn từ 2 đến 100 đánh giá. | Hoạt động tốt. |
| Portfolio | Nút "Tạo danh mục rủi ro" | Gọi `POST /api/climate-risk/portfolios`. | Hoạt động tốt. |
| Danh sách | Nút "Xem chi tiết Portfolio" | Mở xem chi tiết các members của danh mục. | Hoạt động tốt. |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - 100% dữ liệu tọa độ, đánh giá hiểm họa và portfolio được lưu trữ kèm `company_id`.
  - Không có nguy cơ rò rỉ thông tin vị trí tài sản nhạy cảm giữa các doanh nghiệp.
- **Phân quyền vai trò:**
  - Các thao tác tạo vị trí, đánh giá hiểm họa và tạo danh mục đều yêu cầu `requireCompanyAdmin`.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh:**
   - Xây dựng bám sát khung TCFD / IFRS S2, phân tách rõ rủi ro vật lý cấp tính (acute: lũ lụt) và mãn tính (chronic: hạn hán, nắng nóng kéo dài).
   - Kiểm soát tính hợp lệ của nguồn dữ liệu khoa học (ERA5 vs CMIP6) ngay tại backend giúp ngăn ngừa hoàn toàn các báo cáo rủi ro "ngụy tạo".
2. **Điểm cần cải thiện:**
   - **Thiếu bản đồ GIS trực quan:** Người dùng phải nhập tay vĩ độ/kinh độ thay vì có thể xem bản đồ vệ tinh, ghim cơ sở hoặc xem vùng đệm bán kính sai số (`precisionMeters`).
   - Chưa có ma trận nhiệt 5x5 (Exposure vs Vulnerability Heatmap) để hiển thị trực quan các hiểm họa có nguy cơ cao nhất.

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Thay thế Text Input UUID bằng Hộp chọn Chứng từ:** Tương tự các module trước, cho phép chọn chứng từ thẩm định từ Evidence Vault thay vì bắt gõ UUID thủ công trong cả 2 form Location và Assessment.
2. **Bổ sung Bản đồ GIS tương tác (Interactive GIS Map):** Tích hợp Mapbox/Leaflet vào form Location để người dùng có thể nhấp chuột chọn vị trí trên bản đồ, hiển thị vòng tròn bán kính sai số `precisionMeters` và trực quan hóa vị trí nhà máy.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Trực quan hóa Ma trận Rủi ro TCFD (5x5 Heatmap Matrix):** Hiển thị biểu đồ ma trận với trục tung là Phơi nhiễm (Exposure 1–5), trục hoành là Tính tổn thương (Vulnerability 1–5), chấm các điểm hiểm họa để nhận diện ngay các rủi ro nằm trong vùng Đỏ (High Priority).
2. **Bổ sung tính năng Xuất Báo cáo Khí hậu TCFD (Export TCFD Dossier):** Thêm nút tải file báo cáo tổng hợp rủi ro khí hậu vật lý phục vụ báo cáo ESG / IFRS S2 cho nhà đầu tư.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Mở rộng danh mục hiểm họa:** Bổ sung thêm hiểm họa Nước biển dâng (`sea_level_rise`) và Bão nhiệt đới (`typhoon`) theo dữ liệu Kịch bản biến đổi khí hậu của Bộ TN&MT Việt Nam.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Controls Tests | `jest tests/services/climateRiskControls.test.js` | 3/3 tests passed |
| BE Service Tests | `jest tests/services/climateRiskService.test.js` | 2/2 tests passed |
| BE Migration Contract | `jest tests/config/climateRiskMigrationContract.test.js` | 2/2 tests passed |
| FE Component Tests | `vitest run ClimateRiskClient` | 1 test file, 2/2 tests passed |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Người dùng có thể chọn chứng từ từ Evidence Vault cho cả form vị trí và đánh giá (`EvidenceSelector`).
- [x] Tích hợp bản đồ trực quan hiển thị tọa độ GPS đã nhập (`GisCoordinateMap` với buffer bán kính).
- [x] Kiểm thử Quality Gate: nếu chọn kịch bản `historical` với nguồn `CMIP6` hoặc `projection` với nguồn `ERA5_LAND`, hệ thống báo lỗi không cho lưu.
- [x] Kiểm thử tính bất biến của mã băm `assessmentSha256` và `portfolioSha256`.
- [x] Bổ sung ma trận rủi ro 5x5 trên giao diện báo cáo danh mục (TCFD 5x5 Heatmap Matrix).
- [x] Bổ sung xuất file Báo cáo TCFD (CSV) và Bằng chứng Audit (JSON).

---

## 11. Kết luận

Phase 11 (Rủi ro khí hậu - `/climate-risk`) được xây dựng với độ chuẩn xác học thuật và phương pháp luận khí hậu rất cao, tuân thủ nghiêm ngặt các quy định của TCFD và IFRS S2.

Sau khi bổ sung bản đồ GIS trực quan và bộ chọn chứng từ, module sẽ là một công cụ đắc lực hỗ trợ doanh nghiệp Việt Nam đáp ứng yêu cầu công bố thông tin khí hậu từ các thị trường quốc tế khó tính.
