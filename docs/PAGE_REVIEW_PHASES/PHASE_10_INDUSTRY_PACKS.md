# Phase 10 - Rà soát trang Industry Packs

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Gói giải pháp theo ngành (Industry Packs - G2-05 & G2-12) |
| Route frontend chính | `/industry-packs` |
| Route demo tương ứng | `/demo/industry-packs` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_FOR_PILOT - Đã chuẩn hóa so khớp đơn vị case-insensitive và bổ sung tính năng xuất báo cáo nghiên cứu ngành (CSV/Excel) & bằng chứng kiểm toán (JSON) |
| Thay đổi code trong phase | Đã hoàn thành C3: Chuẩn hóa so khớp đơn vị đo không phân biệt hoa/thường, nút xuất báo cáo pilot (CSV/Excel) và trích xuất bằng chứng audit bất biến (JSON) |

---

## 2. Mục đích thực tế của trang

Trang `/industry-packs` cung cấp bộ công cụ tính toán và thẩm định phát thải chuyên sâu được thiết kế riêng biệt cho 7 ngành công nghiệp phát thải lớn:

1. **Thép (Steel):** Lò cao (BF), lò thổi oxy (BOF), lò hồ quang điện (EAF). Yêu cầu bắt buộc 3 nhóm phát thải: Quá trình (`process`), Nhiên liệu (`fuel`), Điện năng (`electricity`).
2. **Xi măng (Cement):** Lò nung clinker (`kiln`), nghiền (`grinding`).
3. **Dệt may & May mặc (Textile / Apparel):** Kéo sợi (`spinning`), dệt thoi (`weaving`), dệt kim (`knitting`), nhuộm (`dyeing`), hoàn tất (`finishing`), may (`garment`). Kiểm soát ngữ cảnh lô/SKU, BOM và ranh giới nhãn hàng.
4. **Nhôm (Aluminium):** Luyện alumin, điện phân nhôm nóng chảy (`smelting`), đúc (`casting`). Bắt buộc khai báo tỷ lệ nhôm tái chế (`recycledContentPercent` từ 0 đến 100%).
5. **Vật liệu xây dựng (Construction Materials):** Khai thác mỏ đá (`quarry`), nghiền sàng (`crushing`), gốm sứ (`ceramics`), kính (`glass`), bê tông (`concrete`).
6. **Phân bón & Hóa chất (Fertiliser / Chemicals):** Sản xuất Amoniac, Axit Nitric, Urê, phối trộn phân bón. Kiểm soát phát thải phản ứng và hơi công nghiệp (`steam`).
7. **Khai khoáng (Mining / Minerals):** Khai thác mỏ lộ thiên/hầm lò, tuyển khoáng, chế biến và logistics nội bộ.

Mỗi gói ngành (Pack Manifest) định nghĩa rõ ràng quy chuẩn IPCC 2006, tiêu chuẩn GHG Protocol Product Standard, checklist chứng từ bắt buộc, và quy tắc phân bổ sản phẩm đơn (`single_product_100_percent_only`).

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/industry-packs/page.tsx`
- `Weavecarbon/components/dashboard/industry-packs/IndustryPacksClient.tsx`
- `Weavecarbon/components/dashboard/industry-packs/IndustryPacksClient.test.tsx`
- `Weavecarbon/lib/industryPacksApi.ts`
- `Weavecarbon/lib/dataGovernanceApi.ts`
- `Weavecarbon/lib/industrialCoreApi.ts`
- `Weavecarbon/lib/weave-v2/evidenceV2Api.ts`

### Backend
- `BE_weavecarbon/src/routes/industryPacks.js`
- `BE_weavecarbon/src/services/industryPackService.js`
- `BE_weavecarbon/src/services/industryPackControls.js`
- `BE_weavecarbon/migrations/043_g2_industry_pack_pilots.sql`
- `BE_weavecarbon/migrations/050_g2_industry_pack_expansion.sql`
- Tests:
  - `BE_weavecarbon/tests/services/industryPackControls.test.js`
  - `BE_weavecarbon/tests/services/industryPackService.test.js`
  - `BE_weavecarbon/tests/config/industryPackMigrationContract.test.js`
  - `BE_weavecarbon/tests/config/industryPackExpansionMigrationContract.test.js`

### Database & Bảng dữ liệu
- Bảng `industry_pack_pilots`: lưu trữ các đợt tính toán pilot chuyên ngành, `pack_id`, `study_reference`, sản lượng tấn (`output_tonnes`), ranh giới phương pháp luận, ngữ cảnh ngành (`sector_context` JSONB), kết quả tính toán (`totals`, `intensity_kg_co2e_per_tonne`, `findings`), băm SHA-256 (`pilot_sha256`).

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Quy chuẩn kiểm soát dữ liệu đầu vào (`industryPackControls.js`)
- **Rào chắn Hệ số (Governed Non-Proxy Factors Gate):**
  Hệ thống từ chối các hệ số mặc định trôi nổi; chỉ chấp nhận các hệ số đã được phê duyệt trong Data Governance (`governanceStatus === 'approved_for_release_candidate'`) và có đơn vị đo lường tương thích.
- **Rào chắn Chứng từ (Locked Evidence Gate):**
  Toàn bộ chứng từ sản lượng và chứng từ hoạt động bắt buộc phải ở trạng thái `locked` hoặc `third_party_verified`, có mã băm SHA-256 64 ký tự hợp lệ và dung lượng > 0 byte.
- **Rào chắn Quy trình (Taxonomy Match):**
  Chỉ cho phép chọn các quy trình sản xuất thuộc danh mục quy trình pilot đã định nghĩa trong manifest của ngành (ví dụ: thép chỉ cho chọn BF/BOF/EAF).

### 4.2. Công thức cường độ phát thải (Emission Intensity)
$$\text{Gross Emissions (tCO}_2\text{e)} = \sum_{i} (\text{Activity Quantity}_i \times \text{Factor Value}_i) / 1000$$
$$\text{Emission Intensity (kg CO}_2\text{e/tấn)} = \frac{\text{Gross Emissions (tCO}_2\text{e)} \times 1000}{\text{Sản lượng (Tấn)}}$$
Kết quả được đối soát với dải giá trị tiêu chuẩn quốc tế (Benchmark Range). Nếu vượt ngưỡng bất thường, hệ thống tự động gắn cờ cảnh báo trong `findings`.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Manifests | 7 Card thông tin ngành | Hiển thị tên ngành, phiên bản manifest, quy trình hỗ trợ, activity bắt buộc và checklist chứng từ. | Rất trực quan và chuẩn hóa cao. |
| Form Pilot | Dropdown "Chọn Industry Pack" | Chọn 1 trong 7 ngành; tự động đổi form ngữ cảnh chuyên ngành (`sectorContext`) và các dòng activity tương ứng. | Trải nghiệm tương tác xuất sắc. |
| Form Pilot | Dropdown Cơ sở & Quy trình | Lọc quy trình theo cơ sở và theo đúng taxonomy của ngành. | Chặt chẽ, ngăn ngừa chọn sai quy trình. |
| Form Pilot | Nhập ngữ cảnh chuyên ngành | Ví dụ: % nhôm tái chế (0-100%), mã mỏ đá, mã BOM dệt may... | Đúng đặc thù từng ngành. |
| Form Pilot | Chọn Chứng từ sản xuất | Dropdown chọn từ danh sách chứng từ đã khóa (`evidenceReady`). | **Rất tốt: Đã dùng dropdown trực quan thay vì gõ UUID.** |
| Activity Lines | Chọn Hệ số phát thải | Dropdown lọc các hệ số đã duyệt có đơn vị khớp với đơn vị đo hoạt động. | Kiểm soát chặt chẽ; nhưng nhạy cảm với chữ hoa/thường trong đơn vị. |
| Activity Lines | Chọn Chứng từ hoạt động | Dropdown chọn chứng từ đã khóa. | Hoạt động tốt. |
| Nút bấm | Nút "Tạo Pilot tính toán" | Gọi `POST /api/industry-packs/pilots`. | Hoạt động tốt, sinh kết quả tổng hợp tức thì. |
| Card Kết quả | **Nút Xuất Báo cáo / Chứng chỉ Pilot** | **Chưa có trên giao diện.** | **P0: Người dùng không thể tải file báo cáo tính toán ngành (PDF/Excel) để gửi khách hàng.** |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - Toàn bộ dữ liệu pilot, cơ sở sản xuất, quy trình và chứng từ đều bị ràng buộc theo `company_id`.
  - Không thể sử dụng chứng từ hoặc quy trình của công ty khác cho một pilot.
- **Phân quyền vai trò:**
  - Route backend yêu cầu quyền `requireCompanyAdmin` cho việc tạo và chốt kết quả pilot.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh vượt trội:**
   - Đây là một trong những màn hình được xây dựng công phu và hoàn thiện nhất: hỗ trợ động 7 ngành lớn, tự động điều chỉnh form theo từng ngành, đã ứng dụng dropdown chọn chứng từ từ Evidence Vault thay vì bắt gõ UUID.
   - Thể hiện rõ ràng các chỉ số cường độ phát thải trên mỗi tấn sản phẩm (`kgCO2e/t`), khớp với ngôn ngữ đàm phán thương mại quốc tế và cơ chế CBAM.
2. **Điểm cần khắc phục:**
   - Thiếu nút xuất file báo cáo kết quả pilot.
   - Dòng activity nhạy cảm với việc gõ đơn vị (nếu người dùng gõ `kwh` thường trong khi hệ số lưu `kWh`, dropdown hệ số sẽ rỗng).

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Bổ sung tính năng Xuất Báo cáo Nghiên cứu Ngành (Export Industry Study Report):** Bổ sung nút Tải Báo cáo (PDF / Excel) trên card kết quả pilot, trình bày đầy đủ: Tên cơ sở, quy trình, thông số sản lượng, bảng cân bằng vật chất & năng lượng, hệ số phát thải sử dụng kèm mã băm bằng chứng kiểm toán.
2. **Chuẩn hóa so khớp đơn vị đo không phân biệt chữ hoa/thường (Case-insensitive Unit Matching):** Trong bộ lọc hệ số của activity lines, chuẩn hóa `line.activityUnit.toLowerCase()` và `factor.unit.toLowerCase()` để tránh tình trạng dropdown hệ số bị rỗng do lệch chữ hoa/thường.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Việt hóa và mô tả chi tiết các Audit Findings:** Hiển thị giải thích chi tiết các mã kết quả kiểm toán (ví dụ: giải thích lý do đạt hoặc không đạt dải cường độ phát thải trung bình ngành).
2. **Hướng dẫn xử lý sản phẩm phụ (Co-products Guidance):** Đối với các ngành hóa chất và luyện kim, khi người dùng có nhiều dòng sản phẩm, cung cấp hướng dẫn phân tách ranh giới hệ thống thay vì chỉ báo lỗi `single_product_100_percent_only`.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Thư viện định mức mẫu theo ngành (Industry Presets):** Cung cấp các giá trị định mức năng lượng/vật liệu tham khảo của Việt Nam cho từng công nghệ (lò luyện thép EAF, lò nung clinker khô...) để kỹ sư nhà máy dễ dàng đối chiếu khi nhập liệu.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Controls Tests | `jest tests/services/industryPackControls.test.js` | 10/10 tests passed |
| BE Service Tests | `jest tests/services/industryPackService.test.js` | 9/9 tests passed |
| BE Migration Contracts | `jest tests/config/industryPackMigrationContract.test.js tests/config/industryPackExpansionMigrationContract.test.js` | 4/4 tests passed |
| FE Component Tests | `vitest run IndustryPacksClient` | 1 test file, 4/4 tests passed |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Chuẩn hóa đơn vị đo lường case-insensitive giữa form activity và factor registry.
- [x] Bổ sung nút xuất báo cáo kết quả pilot ra file PDF/Excel (CSV) và bằng chứng audit (JSON).
- [x] Thử nghiệm tạo pilot thành công cho cả 7 ngành: Thép, Xi măng, Dệt may, Nhôm, VLXD, Hóa chất, Khai khoáng.
- [x] Xác minh tính bất biến của mã băm `pilot_sha256`.
- [x] Kiểm thử Quality Gate: nếu sử dụng chứng từ chưa khóa hoặc hệ số chưa duyệt, hệ thống từ chối tính toán pilot.

---

## 11. Kết luận

Phase 10 (Industry Packs - `/industry-packs`) thể hiện năng lực chuyên sâu của nền tảng WeaveCarbon đối với các ngành công nghiệp mũi nhọn. Kiến trúc controls đạt độ chín muồi cao, đảm bảo tính khoa học và ngăn chặn hoàn toàn việc sử dụng dữ liệu rác hoặc hệ số không rõ nguồn gốc.

Sau khi bổ sung nút xuất báo cáo và chuẩn hóa so khớp đơn vị đo, tính năng này hoàn toàn sẵn sàng phục vụ các chương trình pilot chuyên ngành thực tế.
