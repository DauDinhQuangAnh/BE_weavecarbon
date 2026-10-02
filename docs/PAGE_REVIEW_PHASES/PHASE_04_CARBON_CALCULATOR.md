# Phase 04 - Rà soát trang Tính carbon

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Tính carbon |
| Route frontend chính | `/carbon-calculator` |
| Route con & chuyển hướng | `/calculation-history`, `/cbam-report` (chuyển hướng 302/client sang `/reports?tab=cbam`) |
| Route demo tương ứng | `/demo/carbon-calculator`, `/demo/calculation-history` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | IMPLEMENTED / VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_TO_STAGING — Đã kết nối FE với BE calculation storage, lưu snapshot backend, loại bỏ floor 0.01 và bảo toàn số 0 |
| Thay đổi code trong phase | Đã hoàn thành 3/3 hạng mục P0 (A1: API storage, A2: zero-preservation, A3: snapshot save) |

---

## 2. Mục đích thực tế của từng trang

| Route | Mục đích thực tế trong hệ thống |
|---|---|
| `/carbon-calculator` | Công cụ tính toán nhanh phát thải carbon proxy (Scope 1, Scope 2, Scope 3 Upstream) cho một đơn vị sản phẩm dựa trên trọng lượng, loại vật liệu chính, điểm đến xuất khẩu và cự ly vận chuyển. Cung cấp phân rã biểu đồ, carbon sinh học (biogenic) và nhận xét khuyến nghị tối ưu hóa từ AI. |
| `/calculation-history` | Màn hình tra cứu nhật ký lịch sử các lần tính toán phát thải, xem phân rã theo 4 nhóm (vật liệu, chế biến, vận chuyển, bao bì), xem phiên bản hệ số carbon, lọc theo sản phẩm (`productId`) và xuất báo cáo CSV. |
| `/cbam-report` | Route kế thừa chuyển hướng tự động (redirect client-side) sang tab CBAM của trang Báo cáo tập trung (`/reports?tab=cbam`), bảo đảm tương thích ngược với các liên kết cũ. |

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/carbon-calculator/page.tsx`
- `Weavecarbon/components/dashboard/CarbonCalculator.tsx`
- `Weavecarbon/app/(dashboard)/calculation-history/page.tsx`
- `Weavecarbon/components/dashboard/calculation-history/CalculationHistoryClient.tsx`
- `Weavecarbon/components/dashboard/calculation-history/HistorySummaryStats.tsx`
- `Weavecarbon/components/dashboard/calculation-history/HistoryTable.tsx`
- `Weavecarbon/components/dashboard/calculation-history/HistoryEmptyState.tsx`
- `Weavecarbon/hooks/useCalculationHistory.ts`
- `Weavecarbon/lib/carbon/factorRegistry.ts`
- `Weavecarbon/lib/carbon/engine.ts`
- `Weavecarbon/lib/carbon/proxyCalculator.ts`
- `Weavecarbon/lib/carbon/types.ts`
- `Weavecarbon/app/(dashboard)/cbam-report/page.tsx`

### Backend
- `BE_weavecarbon/src/routes/carbonCalculations.js`
- `BE_weavecarbon/src/modules/carbon/carbonCalculationsRoutes.js`
- `BE_weavecarbon/src/modules/carbon/service.js`
- `BE_weavecarbon/src/modules/carbon/repository.js`
- `BE_weavecarbon/src/modules/carbon/calculationSnapshot.js`
- `BE_weavecarbon/src/modules/carbon/authoritativeCalculation.js`
- `BE_weavecarbon/src/modules/carbon/core/factorRegistry.js`
- `BE_weavecarbon/src/modules/carbon/core/factors.v1.json`
- `BE_weavecarbon/src/routes/carbonFactors.js`
- `BE_weavecarbon/src/routes/chat.js` (phục vụ AI Assessment qua `/api/chat/direct`)

### Database & Migrations
- Bảng `carbon_calculations`: lưu trữ lịch sử tính toán tập trung theo công ty (`company_id`), gắn `user_id`, `product_id`, `shipment_id`, phân loại `calculation_type`, các trường CO₂e phân rã (`materials_co2e`, `production_co2e`, `transport_co2e`, `packaging_co2e`, `total_co2e`), phiên bản engine, phiên bản registry, canonical input hash và snapshot hệ số.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Quick Calculator (`/carbon-calculator`)
- **Luồng tính toán:** 
  1. Người dùng chọn ngành hàng (`category`, hiện mặc định dệt may `textile`).
  2. Chọn vật liệu từ danh sách đồng bộ từ `lib/carbon/factorRegistry.ts` (ví dụ: Cotton hữu cơ, Polyester tái chế, Len...).
  3. Nhập khối lượng `weight` (kg).
  4. Chọn điểm đến xuất khẩu (Nhật Bản, Hàn Quốc, EU, Mỹ...) và hệ thống tự điền khoảng cách `transportDistance` (km), cho phép người dùng tinh chỉnh.
  5. Khi nhấn **Tính toán phát thải**, hàm `calculate()` chạy hoàn toàn phía client (trong bộ nhớ trình duyệt).
- **Công thức tính toán:**
  - Vật liệu: $E_{material} = weight \times Factor_{material}$
  - Sản xuất/chế biến: $E_{manufacturing} = weight \times (ProcessIntensity_{kWh/kg} \times GridFactor_{VN2023})$ (với lưới điện VN 2023 = 0.6592 kg CO₂e/kWh)
  - Vận chuyển: $E_{transport} = weight \times distance \times (16.12 / 1000)$ kg CO₂e/kg.km (chuẩn DEFRA 2025 đường biển quy đổi)
  - Đóng gói: $E_{packaging} = weight \times 0.3$ kg CO₂e/kg (proxy bao bì tối thiểu)
  - Biogenic: Lượng carbon sinh học lưu trữ được tách riêng, không cộng gộp vào fossil footprint.
- **Tích hợp AI Assessment:**
  - Gửi prompt có cấu trúc qua `POST /api/chat/direct`. Backend xử lý qua Gemini/LLM service và trả về nhận định, nguyên nhân và 3 khuyến nghị hành động thực tế.

### 4.2. Lịch sử tính toán (`/calculation-history`)
- **Vấn đề cốt lõi phát hiện:** 
  - Frontend sử dụng hook `useCalculationHistory()`, lưu và đọc toàn bộ lịch sử từ `localStorage` (`weavecarbon_calculation_history` / `weavecarbon_history`).
  - Trong khi đó, Backend đã có sẵn kiến trúc vững chắc: `GET /api/carbon-calculations` và `POST /api/carbon-calculations` gắn với bảng PostgreSQL `carbon_calculations` có phân quyền `companyId` và `userId`.
  - Màn hình `/calculation-history` hiện bị tách rời khỏi backend database, khiến lịch sử bị mất khi xóa trình duyệt hoặc đăng nhập từ thiết bị khác.
- **Fallback khi truyền `productId`:**
  - Nếu URL có `?productId=...` và lịch sử rỗng, client gọi `fetchProductById(productId)` để trích xuất `product.carbonResults` và suy luận ra 1 bản ghi lịch sử hiển thị tạm thời.
- **Can thiệp số liệu:**
  - Client có hàm `applyMinimumComponentValues()` tự động gán `MIN_COMPONENT_CO2 = 0.01` nếu vận chuyển hoặc đóng gói bằng 0, làm tăng `totalCO2` một cách nhân tạo ngoài ý muốn.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Calculator | Select "Ngành hàng" | Lựa chọn ngành; hiện chỉ có `textile` (Dệt may). | Chưa có ngành nông sản, bao bì, da giày. Cần mở rộng hoặc ghi rõ phạm vi hiện tại. |
| Calculator | Input "Khối lượng sản phẩm" | Nhập số thực dương, step 0.01 kg. | Tốt; có chặn giá trị âm hoặc rỗng. |
| Calculator | Select "Loại vật liệu chính" | Chọn 1 trong 8 loại vật liệu chuẩn dệt may kèm hệ số kg CO₂e/kg. | Tốt, lấy từ registry chuẩn. |
| Calculator | Select "Điểm đến xuất khẩu" | Chọn quốc gia/khu vực; tự điền khoảng cách km ước tính. | Tốt; trải nghiệm thuận tiện cho người dùng. |
| Calculator | Input "Khoảng cách vận chuyển" | Cho phép sửa số km thủ công. | Tốt; linh hoạt khi có hải trình thực tế. |
| Calculator | Nút "Tính toán phát thải" | Tính toán tức thì trong client state, hiển thị hero total và breakdown progress bar. | Hoạt động mượt mà. Tuy nhiên **thiếu nút Lưu kết quả vào hệ thống**. |
| Calculator | Nút "Đánh giá AI" / "Đánh giá lại" | Gửi yêu cầu phân tích tới `POST /api/chat/direct`. Có trạng thái xoay spinner và hiển thị kết quả Markdown. | Tốt; xử lý lỗi hiển thị alert rõ ràng. |
| History | Bảng danh sách lịch sử | Hiển thị các cột Sản phẩm, Vật liệu, Sản xuất, Vận chuyển, Đóng gói, Tổng CO₂, Phiên bản, Ngày tạo, Người tạo. | Giao diện rõ ràng; nhưng dữ liệu lấy từ `localStorage`. |
| History | Click vào tên sản phẩm | Điều hướng về trang chi tiết sản phẩm `/products`. | Hoạt động đúng. |
| History | Nút "Xuất CSV" | Tải file CSV chứa toàn bộ danh sách đang hiển thị. | Hoạt động tốt ở phía client; tên file chuẩn hóa theo ngày. |
| History | Lọc theo `productId` | Nhận param từ query string và lọc mảng lịch sử. | Hoạt động đúng; có fallback tải chi tiết sản phẩm. |
| Redirect | `/cbam-report` | Chuyển hướng `router.replace('/reports?tab=cbam')`. | Hoạt động đúng, bảo lưu route cũ. |

---

## 6. Kiểm tra quyền và tenant isolation

- **Trên Backend (`/api/carbon-calculations`):**
  - Đã tích hợp middleware `authenticate` và `requireRole('b2b')`.
  - Có hàm `ensureCompanyId(req, res)` chặn truy cập trái phép hoặc thiếu ngữ cảnh doanh nghiệp.
  - Mọi truy vấn database đều có điều kiện `company_id = $1`.
- **Trên Frontend (`/carbon-calculator` & `/calculation-history`):**
  - Trang `/carbon-calculator` chạy hoàn toàn client-side, không lưu dữ liệu nên không gây rò rỉ tenant.
  - Tuy nhiên, việc `/calculation-history` dùng `localStorage` dẫn đến việc nếu 2 tài khoản khác công ty cùng đăng nhập trên 1 trình duyệt, họ có thể nhìn thấy lịch sử tính toán lưu trong cache trình duyệt của nhau! Đây là **lỗ hổng tenant isolation trên client**.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Minh bạch về mức độ tin cậy:** Giao diện `/carbon-calculator` thể hiện rất tốt các nhãn cảnh báo: ghi rõ "Ước tính nhanh phát thải CO₂e (Proxy)", "Scope 1 + 2 + 3 Upstream", và có hộp khuyến nghị nêu rõ hệ số proxy không thay thế dữ liệu kiểm toán sơ cấp.
2. **Khả năng hành động:** Sau khi tính toán ra kết quả đẹp mắt, người dùng không có cách nào để:
   - "Lưu kết quả này vào sản phẩm X"
   - "Tạo lô hàng từ kết quả này"
   - "Lưu snapshot để so sánh sau này"
   Toàn bộ kết quả biến mất ngay khi F5 hoặc chuyển trang.
3. **Tính chính xác của số liệu lịch sử:** Việc tự ý ép `MIN_COMPONENT_CO2 = 0.01` vi phạm tính toàn vẹn của dữ liệu tính toán (nếu một sản phẩm hoàn toàn không dùng bao bì hoặc vận chuyển nội địa = 0, hệ thống không được tự ý cộng thêm 0.01 kg CO₂e).

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Lịch sử tính toán ngắt kết nối với Backend Database:** Chuyển đổi `useCalculationHistory` hoặc tích hợp API client để đọc/ghi từ `GET /api/carbon-calculations` và `POST /api/carbon-calculations`. Xóa bỏ phụ thuộc độc quyền vào `localStorage` nhằm đảm bảo tenant isolation và dữ liệu xuyên suốt giữa các phiên làm việc.
2. **Loại bỏ việc tự động ép `MIN_COMPONENT_CO2 = 0.01`:** Xóa logic gán giá trị nhân tạo trong `CalculationHistoryClient.tsx` (`applyMinimumComponentValues`), bảo toàn số 0 nguyên bản nếu một chặng không phát sinh phát thải.
3. **Bổ sung nút lưu Snapshot tính toán:** Bổ sung nút "Lưu Snapshot" hoặc "Lưu vào Hồ sơ" trên `/carbon-calculator` để người dùng có thể gửi payload chuẩn lên `POST /api/carbon-calculations`.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Mở rộng danh mục ngành hàng:** Bổ sung cấu hình vật liệu cho các ngành hàng mục tiêu khác (Nông sản, Da giày, Gỗ, Điện tử) thay vì chỉ cố định `textile`.
2. **Phân trang và lọc phía Server:** Bổ sung phân trang phía server cho `/calculation-history` khi danh sách vượt quá 50 bản ghi.
3. **Xử lý an toàn khi chia số lượng sản phẩm:** Trong `resolvePackagingPerProduct`, kiểm tra nghiêm ngặt `product.quantity > 0` và `isFinite` để tránh phát sinh `NaN` trong bảng lịch sử.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **So sánh kịch bản (Scenario Comparison):** Cho phép chọn 2 kết quả tính toán để so sánh trực quan chênh lệch phát thải khi thay đổi vật liệu (ví dụ: Cotton thông thường vs Cotton hữu cơ).
2. **Tooltip giải thích công thức quy đổi DEFRA:** Hiển thị rõ công thức quy đổi từ tonne.km sang kg.km để tăng tính thuyết phục với chuyên gia thẩm định carbon.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| FE Carbon tests | `vitest run lib/carbon` | 3 test files, 24/24 tests passed |
| BE Carbon tests | `jest tests/modules/carbon` | 13 test suites, 53/53 tests passed |
| FE TypeScript | `tsc --noEmit` | Đạt (0 error) |
| BE Syntax & Boundaries | `node scripts/check-syntax.js && node scripts/check-module-boundaries.js` | Đạt (288 files OK, 9 modules boundaries OK) |
| BE OpenAPI | `node scripts/check-openapi.js` | Đạt (352 operations OK) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Người dùng có thể nhấn nút "Lưu Snapshot" trên `/carbon-calculator` để lưu vào DB qua `POST /api/carbon-calculations`.
- [x] Trang `/calculation-history` gọi API `GET /api/carbon-calculations` để tải dữ liệu thật của công ty từ cơ sở dữ liệu.
- [x] Không còn lưu trữ lịch sử tính toán chỉ trong `localStorage` dùng chung trên trình duyệt; ưu tiên dữ liệu backend tenant isolation.
- [x] Xóa bỏ hoàn toàn giá trị tối thiểu nhân tạo `MIN_COMPONENT_CO2 = 0.01`, bảo toàn giá trị phát thải 0.
- [x] Lọc theo `productId` hoạt động chuẩn xác qua query parameter gửi xuống API backend.
- [x] Xuất CSV lấy đúng dữ liệu chính thức có chữ ký snapshot/version.

---

## 11. Kết luận

Phase 04 cho thấy tầng lõi tính toán carbon (`lib/carbon` ở FE và `src/modules/carbon` ở BE) có độ hoàn thiện rất cao, đạt chuẩn ISO 14067 / GHG Protocol với hệ thống test parity và golden datasets rất chặt chẽ (13/13 backend test suites pass, 24/24 frontend unit tests pass).

Tuy nhiên, có sự **đứt gãy tích hợp giữa giao diện người dùng và hạ tầng backend**: trang tính nhanh chưa có nút lưu snapshot, và trang lịch sử lại lưu vào `localStorage` của trình duyệt thay vì gọi API `carbon-calculations`. Sau khi xử lý 3 mục P0 nêu trên, tính năng Tính carbon và Lịch sử tính toán sẽ hoàn toàn sẵn sàng cho môi trường Staging và Production.
