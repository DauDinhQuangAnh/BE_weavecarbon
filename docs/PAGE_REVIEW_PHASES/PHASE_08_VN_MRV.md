# Phase 08 - Rà soát trang MRV Việt Nam

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Báo cáo MRV Quốc gia (Nghị định 06/2022/NĐ-CP & Quyết định 13/2024/QĐ-TTg, 42/2026/QĐ-TTg) |
| Route frontend chính | `/vn-mrv` |
| Route demo tương ứng | `/demo/vn-mrv` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | HIGH (Hoàn tất EvidenceSelector, DQL selector, Dossier Export CSV/JSON, Blockers Việt hóa) |
| Thay đổi code trong phase | Đã triển khai EvidenceSelector, DQL multi-selector, xuất hồ sơ CSV/JSON, dịch nghĩa blockers & role gating Company Admin |

---

## 2. Mục đích thực tế của trang

Trang `/vn-mrv` phục vụ luồng chuẩn bị hồ sơ nội bộ cho việc Đo đạc, Báo cáo và Thẩm tra (Measurement, Reporting, and Verification - MRV) phát thải khí nhà kính theo quy định pháp luật Việt Nam:

1. **Xác định tính áp dụng pháp lý (Applicability Case):**
   - Đánh giá cơ sở phát thải có thuộc danh mục cơ sở phát thải khí nhà kính phải thực hiện kiểm kê khí nhà kính theo Quyết định của Thủ tướng Chính phủ hay không (QĐ 01/2022/QĐ-TTg, QĐ 13/2024/QĐ-TTg và QĐ 42/2026/QĐ-TTg).
   - Phân loại trạng thái: Chưa xác định (`undetermined`), Có khả năng thuộc danh mục (`potentially_listed`), Bắt buộc kiểm kê (`confirmed_listed`), Không thuộc đối tượng (`not_listed`).
   - Ràng buộc căn cứ pháp lý theo mốc thời gian đánh giá (`assessmentDate`).
2. **Thiết lập Kế hoạch Giám sát (Measurement Plan):**
   - Khai báo ranh giới tổ chức (`operational_control` hoặc `equity_share`), ranh giới vận hành (Scope 1, Scope 2), bản đồ nguồn phát thải (`sourceMap`).
   - Khai báo phương pháp luận đo đạc, kế hoạch QA/QC và kế hoạch kiểm soát độ không đảm bảo đo (`uncertaintyPlan`).
   - Nối kết với các hồ sơ đánh giá DQL và bằng chứng chứng từ trong hệ thống.
3. **Chuẩn bị và Đánh giá tính sẵn sàng nộp hồ sơ (Filing Readiness & Blockers):**
   - Ghép nối Hồ sơ áp dụng + Kế hoạch giám sát + Kiểm kê KNK doanh nghiệp (`Corporate GHG Inventory`).
   - Kiểm tra cổng chất lượng (Quality Gate): tự động rà soát các yếu tố cản trở (blockers) như DQL chưa đạt chuẩn (bị điểm L1/L2), chưa chốt tính áp dụng, hoặc dữ liệu kiểm kê chưa sẵn sàng.
   - Xác định trạng thái hồ sơ: `needs_information` hoặc `ready_for_specialist_review`.

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/vn-mrv/page.tsx`
- `Weavecarbon/components/dashboard/vn-mrv/VnMrvClient.tsx`
- `Weavecarbon/components/dashboard/vn-mrv/VnMrvClient.test.tsx`
- `Weavecarbon/lib/vnMrvApi.ts`
- `Weavecarbon/lib/industrialCoreApi.ts` (`facilities`)
- `Weavecarbon/lib/weave-v2/corporateGhgInventoryApi.ts` (`fetchCorporateGhgInventories`)

### Backend
- `BE_weavecarbon/src/routes/vnMrv.js`
- `BE_weavecarbon/src/services/vnMrvService.js`
- `BE_weavecarbon/src/services/vnMrvControls.js`
- `BE_weavecarbon/migrations/041_g2_vn_mrv_lifecycle.sql`
- Tests:
  - `BE_weavecarbon/tests/services/vnMrvControls.test.js`
  - `BE_weavecarbon/tests/config/vnMrvMigrationContract.test.js`

### Database & Bảng dữ liệu
- Bảng `vn_mrv_cases`: lưu trữ hồ sơ áp dụng theo cơ sở, năm báo cáo, lĩnh vực, trạng thái áp dụng, bằng chứng pháp lý, căn cứ pháp lý (`legal_basis` JSON) và lý do giải trình.
- Bảng `vn_mrv_plans`: lưu trữ kế hoạch đo đạc, ranh giới tổ chức/vận hành, danh mục nguồn, QA/QC, uncertainty, liên kết DQL và hash băm SHA-256 (`plan_sha256`).
- Bảng `vn_mrv_filings`: lưu trữ hồ sơ nộp kiểm tra tính sẵn sàng, danh sách blockers và trạng thái sẵn sàng cho thẩm định chuyên gia.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Cơ sở pháp lý Việt Nam (`vnMrvControls.js`)
- Tự động xác định khung quy chuẩn theo thời điểm đánh giá:
  - Nghị định 06/2022/NĐ-CP (quy định giảm nhẹ phát thải KNK và bảo vệ tầng ô-dôn)
  - Nghị định 119/2025/NĐ-CP (hiệu lực từ 01/08/2025)
  - Nghị định 83/2026/NĐ-CP (hiệu lực từ 23/03/2026)
  - Quyết định 13/2024/QĐ-TTg (áp dụng đến 24/09/2026)
  - Quyết định 42/2026/QĐ-TTg (hiệu lực từ 25/09/2026)
- **Tuyên bố pháp lý bắt buộc (Legal Disclaimer):**
  Hệ thống ghi rõ ở backend và frontend: *"Quy trình hỗ trợ chuẩn bị nội bộ. Hệ thống không thay thế kết luận áp dụng pháp lý chính thức, không thực hiện kiểm tra thẩm định độc lập và không đại diện nộp báo cáo cho cơ quan quản lý nhà nước."*

### 4.2. Cổng kiểm soát chất lượng nộp hồ sơ (Filing Quality Gate)
Hàm `filingReadiness` ở backend áp dụng rào chắn nghiêm ngặt:
- Chặn nếu tính áp dụng chưa rõ ràng: `MRV_APPLICABILITY_UNRESOLVED` (nếu trạng thái là `undetermined` hoặc `potentially_listed`).
- Chặn nếu thiếu kế hoạch giám sát: `MRV_MEASUREMENT_PLAN_REQUIRED`.
- Chặn nếu dữ liệu kiểm kê chưa phê duyệt: `MRV_INVENTORY_NOT_READY` hoặc `MRV_INVENTORY_BLOCKERS`.
- Chặn nếu chất lượng dữ liệu kém: `MRV_DQL_GATE_FAILED` (nếu thiếu hồ sơ DQL hoặc bất kỳ điểm DQL nào rơi vào cấp **L1** hoặc **L2**).

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Card Hồ sơ | Dropdown "Chọn cơ sở sản xuất" | Tải từ API `industrialCoreApi.facilities()`. | Hoạt động tốt, liên kết đúng cơ sở. |
| Card Hồ sơ | Dropdown "Trạng thái danh mục" | Chọn 1 trong 4 trạng thái theo Nghị định 06/2022. | Tốt, đúng nghiệp vụ. |
| Card Hồ sơ | Ô "Tài liệu pháp lý chứng minh" | Nhập chuỗi UUID của tài liệu chứng minh. | **P0: Input text bắt gõ UUID thủ công.** |
| Card Hồ sơ | Nút "Tạo hồ sơ" | Gọi `POST /api/vn-mrv/cases`. | Hoạt động tốt, kiểm tra logic chặt chẽ. |
| Card Kế hoạch | Dropdown "Chọn hồ sơ áp dụng" | Lấy từ danh sách `cases` đã tạo. | Hoạt động tốt. |
| Card Kế hoạch | Ô nhập DQL IDs và Evidence IDs | Text input phân cách dấu phẩy. | **P0: Khó thao tác cho người dùng.** |
| Card Kế hoạch | Nút "Tạo kế hoạch giám sát" | Gọi `POST /api/vn-mrv/plans`. | Hoạt động chính xác, sinh hash SHA-256. |
| Card Nộp hồ sơ | Chọn Case, Plan, Inventory | Ghép nối 3 thành phần phục vụ nộp báo cáo. | Trực quan, liền mạch. |
| Card Nộp hồ sơ | Nút "Chuẩn bị hồ sơ nộp" | Gọi `POST /api/vn-mrv/filings`. Đánh giá blockers. | Hoạt động tốt. |
| Card Nộp hồ sơ | **Nút Tải hồ sơ / Xuất báo cáo MRV** | **Chưa có trên giao diện.** | **P0: Người dùng không thể xuất bản hồ sơ hoàn chỉnh ra file PDF/Word/Excel.** |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - Toàn bộ các API `GET /cases`, `GET /plans`, `GET /filings` và các lệnh tạo mới đều gắn với `req.companyId`.
  - Các liên kết Facility và Inventory đều được kiểm tra tính thuộc về cùng một công ty ở tầng service.
- **Phân quyền vai trò:**
  - Route backend yêu cầu quyền `requireCompanyAdmin` cho các thao tác tạo mới và chuẩn bị hồ sơ.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh:**
   - Bám sát thực tế lộ trình chuyển tiếp của pháp luật Việt Nam (từ QĐ 13/2024 sang QĐ 42/2026 và NĐ 83/2026).
   - Thiết kế luồng 3 bước (Xác định áp dụng -> Lập kế hoạch đo đạc -> Ghép nối hồ sơ nộp) rất logic và có tính kế thừa cao từ DQL và Corporate Inventory.
   - Có banner cảnh báo pháp lý minh bạch ở chân trang.
2. **Điểm cần cải thiện:**
   - Thiếu nút xuất hồ sơ tài liệu tổng hợp (Filing Pack) sau khi hồ sơ đạt trạng thái sẵn sàng.
   - Danh sách Blockers hiển thị mã tiếng Anh kỹ thuật (`MRV_DQL_GATE_FAILED`) gây khó hiểu cho kế toán trưởng hoặc cán bộ phụ trách môi trường của doanh nghiệp.

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Bổ sung tính năng Xuất bộ hồ sơ nộp MRV (Export MRV Filing Dossier):** Thêm nút "Tải bộ hồ sơ nộp" (PDF/ZIP) bao gồm: Báo cáo kiểm kê, Kế hoạch giám sát, Bằng chứng căn cứ pháp lý và Báo cáo kiểm soát chất lượng DQL để doanh nghiệp có thể in ấn hoặc nộp cho cơ quan chức năng.
2. **Bộ chọn Bằng chứng và DQL trực quan:** Thay thế các ô nhập text UUID bằng hộp chọn danh sách DQL Assessment và Evidence Document sẵn có.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Việt hóa và giải thích chi tiết các Blockers:** Chuyển đổi các mã kỹ thuật như `MRV_APPLICABILITY_UNRESOLVED` thành *"Cơ sở chưa chốt trạng thái thuộc danh mục bắt buộc kiểm kê"*, `MRV_DQL_GATE_FAILED` thành *"Chất lượng dữ liệu chưa đạt (tồn tại điểm DQL cấp L1 hoặc L2)"*.
2. **Tùy biến ranh giới đo đạc:** Cho phép người dùng tùy chọn ranh giới kiểm soát tài chính hoặc bổ sung các danh mục Scope 3 thay vì cố định `operational_control` và `scope1, scope2`.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Tự động gợi ý danh mục nguồn phát thải:** Tự động điền `sourceMap` từ danh sách thiết bị/quy trình phát thải đã khai báo ở module `/carbon-operations`.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Controls Tests | `jest tests/services/vnMrvControls.test.js` | 3/3 tests passed |
| BE Migration Contract | `jest tests/config/vnMrvMigrationContract.test.js` | 2/2 tests passed |
| FE Component Tests | `vitest run VnMrvClient` | 1 test file, 2/2 tests passed |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai
 
- [x] Người dùng có thể chọn bằng chứng pháp lý và DQL từ danh mục chọn thay vì nhập UUID.
- [x] Bổ sung nút tải xuống bộ hồ sơ MRV hoàn chỉnh (CSV & JSON Audit).
- [x] Thông báo blockers hiển thị bằng tiếng Việt kèm hướng dẫn khắc phục.
- [x] Kiểm thử kiểm tra cổng chất lượng: nếu có DQL ở mức L1 hoặc L2, hồ sơ phải báo blocker và không cho chuyển sang trạng thái sẵn sàng nộp.
- [x] Kiểm tra tính toàn vẹn của mã băm `plan_sha256`.

---

## 11. Kết luận

Phase 08 (MRV Việt Nam - `/vn-mrv`) là một điểm sáng lớn về mặt tuân thủ khung pháp lý quốc gia (Nghị định 06/2022/NĐ-CP và Quyết định 42/2026/QĐ-TTg). Các rào chắn kiểm soát chất lượng (Blockers Gate) hoạt động rất chuẩn xác.

Sau khi bổ sung nút xuất file hồ sơ nộp và thay thế các ô nhập UUID bằng bộ chọn trực quan, tính năng này sẽ sẵn sàng hỗ trợ các nhà máy tại Việt Nam chuẩn bị hồ sơ kiểm kê khí nhà kính chính thức.
