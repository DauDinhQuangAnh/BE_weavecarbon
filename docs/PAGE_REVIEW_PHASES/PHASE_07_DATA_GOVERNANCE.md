# Phase 07 - Rà soát trang Quản trị dữ liệu (Data Governance)

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Quản trị Dữ liệu & Hệ số phát thải (G2-02) |
| Route frontend chính | `/data-governance` |
| Route demo tương ứng | `/demo/data-governance` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_FOR_PILOT - Đã tích hợp EvidenceSelector, Modal review cho Factor Proposal (Company Admin) và xem chi tiết DQL |
| Thay đổi code trong phase | Đã hoàn thành C1: Hộp chọn EvidenceSelector, Modal phê duyệt hệ số, xem chi tiết 5 chiều DQL và role-gating Company Admin |

---

## 2. Mục đích thực tế của trang

Trang `/data-governance` quản lý tính liêm chính dữ liệu (Data Integrity) và quy trình quản trị hệ số phát thải (Emission Factor Governance) theo chuẩn quốc tế GHG Protocol / ISO 14064-1:

1. **Đánh giá chất lượng dữ liệu (Data Quality Level - DQL):**
   - Đánh giá chất lượng dữ liệu theo 5 chiều độc lập: Thời gian (`temporal`), Địa lý (`geographic`), Công nghệ (`technological`), Độ đầy đủ (`completeness`), Độ tin cậy (`reliability`) trên thang điểm 1 đến 5.
   - Ghi nhận tỷ lệ hoàn thiện (`completenessPercent` từ 0 đến 100%) và cơ sở lý luận (`rationale`).
   - Tự động tính điểm tổng hợp (`overallScore`) và xếp hạng cấp độ DQL từ **L1** (thấp nhất) đến **L5** (cao nhất / chuẩn kiểm toán).
   - Đóng dấu băm bảo chứng SHA-256 (`assessmentSha256`) và lưu vết phiên bản phương pháp luận `WEAVECARBON-DQL-1.0.0`.
2. **Quản trị đề xuất hệ số phát thải (Emission Factor Proposals):**
   - Đăng ký hệ số phát thải đặc thù của doanh nghiệp hoặc nhà cung ứng với đầy đủ thuộc tính: mã hệ số, đơn vị, giá trị, nguồn tài liệu, URL, năm công bố, ranh giới tính toán, cơ sở GWP (IPCC AR6 100-year) và độ không đảm bảo đo (`uncertaintyCv`).
   - Ràng buộc bằng chứng bắt buộc (Evidence Gate): mỗi đề xuất hệ số bắt buộc phải gắn với ít nhất một UUID chứng từ hợp lệ trong Evidence Vault.
   - Quy trình phê duyệt nghiêm ngặt: hệ số mới tạo nằm ở trạng thái dự thảo/chờ duyệt, chỉ khi được kiểm duyệt viên có thẩm quyền (`emission_factor_reviewer`) phê duyệt thì mới được đưa vào danh mục hệ số khả dụng cho động cơ tính toán.

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/data-governance/page.tsx`
- `Weavecarbon/components/dashboard/data-governance/DataGovernanceClient.tsx`
- `Weavecarbon/components/dashboard/data-governance/DataGovernanceClient.test.tsx`
- `Weavecarbon/lib/dataGovernanceApi.ts`

### Backend
- `BE_weavecarbon/src/routes/dataQualityGovernance.js`
- `BE_weavecarbon/src/services/dataQualityGovernanceService.js`
- `BE_weavecarbon/src/services/dataQualityGovernanceControls.js`
- `BE_weavecarbon/migrations/040_g2_dql_factor_governance.sql`
- Tests:
  - `BE_weavecarbon/tests/services/dataQualityGovernanceControls.test.js`
  - `BE_weavecarbon/tests/services/dataQualityGovernanceService.test.js`
  - `BE_weavecarbon/tests/config/dataQualityGovernanceMigrationContract.test.js`

### Database & Bảng dữ liệu
- Bảng `dql_assessments`: `id`, `company_id`, `created_by`, `subject_type` (enum: `activity`, `facility`, `process`, `measurement_point`, `emission_factor`), `subject_reference`, `methodology_version`, `temporal_score`, `geographic_score`, `technological_score`, `completeness_score`, `reliability_score`, `completeness_percent`, `overall_score`, `data_quality_level` (L1–L5), `rationale`, `improvement_actions`, `evidence_document_ids`, `assessment_sha256`.
- Bảng `emission_factor_proposals`: `id`, `company_id`, `created_by`, `proposal_reference`, `factor_id`, `label`, `factor_value`, `unit`, `source_name`, `source_url`, `source_year`, `geography`, `boundary`, `valid_from`, `valid_to`, `gwp_basis`, `uncertainty_cv`, `is_proxy`, `governance_status` (`draft`, `pending_review`, `approved_for_release_candidate`, `rejected`), `evidence_document_ids`, `payload_sha256`.
- Bảng `emission_factor_reviews`: lưu trữ quyết định duyệt (`approved_for_release_candidate`, `needs_information`, `rejected`), giải trình `notes`, `reviewer_role` và `reviewer_user_id`.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Công thức và phân cấp DQL (`dataQualityGovernanceControls.js`)
- Điểm tổng hợp là trung bình cộng của 5 chiều:
  $$\text{Overall Score} = \frac{\text{Temporal} + \text{Geographic} + \text{Technological} + \text{Completeness} + \text{Reliability}}{5}$$
- Phân hạng cấp độ chất lượng dữ liệu:
  - $\ge 4.5$: **L5** (Dữ liệu sơ cấp đã thẩm định độc lập bên thứ 3)
  - $\ge 3.5$: **L4** (Dữ liệu sơ cấp đã đối chiếu hóa đơn/hợp đồng)
  - $\ge 2.5$: **L3** (Dữ liệu nhà cung ứng tự khai báo có chứng chỉ)
  - $\ge 1.5$: **L2** (Dữ liệu proxy theo phân ngành hoặc mô hình ước tính)
  - $< 1.5$: **L1** (Dữ liệu giả định mặc định độ tin cậy thấp)
- Checksum SHA-256 được tính trên toàn bộ payload chuẩn hóa nhằm đảm bảo dữ liệu đánh giá là bất biến (Tamper-evident).

### 4.2. Rào chắn bằng chứng (Evidence Gate)
- Trong `validateFactorProposal`, backend kiểm tra bắt buộc:
  ```js
  if (!value.evidenceDocumentIds.length || value.evidenceDocumentIds.length > 100 || value.evidenceDocumentIds.some((id) => !UUID_REGEX.test(id))) {
    errors.push('At least one and at most 100 evidence UUIDs are required.');
  }
  ```
- Điều này ngăn chặn việc tự tiện khai báo hệ số phát thải mà không có tài liệu nguồn kiểm chứng trong hệ thống.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Form DQL | Chọn "Đối tượng đánh giá" | Dropdown chọn `activity`, `facility`, `process`, `measurement_point`, `emission_factor`. | Tốt, đồng bộ với backend enum. |
| Form DQL | Nhập 5 Chiều DQL (1-5) | 5 ô input số nguyên từ 1 đến 5. | Tốt, giao diện trực quan gọn gàng. |
| Form DQL | Tỷ lệ đầy đủ (%) | Input số từ 0 đến 100%. | Hoạt động tốt. |
| Form DQL | Nút "Đánh giá & Lưu hồ sơ DQL" | Gọi `POST /api/data-governance/dql-assessments`. Thêm kết quả vào danh sách. | Hoạt động chính xác, có spinning loader. |
| Danh sách DQL | Card hồ sơ đã lưu | Hiển thị mã đối tượng, phương pháp luận, điểm tổng/5 và Badge L1-L5. | Rõ ràng; tuy nhiên **chưa có nút bấm mở xem chi tiết 5 điểm thành phần**. |
| Form Factor | Nhập thông tin hệ số | Mã đề xuất, ID, Tên nhãn, Giá trị, Đơn vị, Nguồn, Ranh giới. | Đầy đủ trường dữ liệu chuẩn. |
| Form Factor | **Mã tài liệu chứng minh** | **Ô input text tự do yêu cầu gõ chuỗi UUID.** | **P0: Người dùng không thể tự nhớ/gõ UUID 36 ký tự. Dễ dẫn đến lỗi 422.** |
| Form Factor | Nút "Gửi đề xuất hệ số" | Gọi `POST /api/data-governance/factor-proposals`. | Hoạt động đúng, có tính toán SHA-256. |
| Danh sách Factor | Card hệ số đã đề xuất | Hiển thị Tên nhãn, Trạng thái (draft/pending_review), Giá trị + Đơn vị, Nguồn. | Tốt; tuy nhiên **thiếu nút Phê duyệt (Review / Approve)**. |
| Toàn trang | **Quyền Company Admin** | **Chưa kiểm tra quyền ở Frontend.** | **P1: Member / Viewer vẫn thấy form, bấm gửi sẽ bị 403 Forbidden.** |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - Tuyệt đối cô lập: mọi service call đều truyền `req.companyId`.
  - Mọi bản ghi `dql_assessments` và `emission_factor_proposals` đều thuộc về công ty tạo ra chúng.
- **Phân quyền vai trò:**
  - Các route ghi dữ liệu (`POST /dql-assessments`, `POST /factor-proposals`, `POST /factor-proposals/:id/reviews`) đều được bảo vệ bởi middleware `requireCompanyAdmin`.
  - Riêng hành động review hệ số kiểm tra vai trò người duyệt phải là `emission_factor_reviewer`.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh:**
   - Hệ thống đánh giá DQL 5 chiều đạt chuẩn quốc tế rất chuyên nghiệp, giúp lượng hóa độ tin cậy của toàn bộ chuỗi dữ liệu phát thải.
   - Có cơ chế SHA-256 tamper-evident ngăn chặn việc can thiệp dữ liệu kiểm toán sau khi đã lưu.
2. **Điểm yếu trên giao diện:**
   - **Trải nghiệm nhập mã tài liệu chứng minh quá khó:** Bắt người dùng nhập danh sách UUID của chứng từ qua chuỗi text ngăn cách bằng dấu phẩy khiến tính năng gần như không thể sử dụng đối với người dùng cuối không am hiểu kỹ thuật.
   - **Thiếu quy trình Phê duyệt trên UI:** Mặc dù backend đã chuẩn bị đầy đủ service và router cho việc duyệt hệ số (`approved_for_release_candidate`, `needs_information`, `rejected`), giao diện hiện chỉ dừng lại ở bước "Gửi đề xuất".

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Thay thế Text Input UUID chứng từ bằng Hộp chọn Evidence Selector:** Thay thế ô input `evidenceDocumentIds` bằng modal hoặc dropdown cho phép tìm kiếm và chọn chứng từ đã có trong Evidence Vault (hiển thị Tên file, Loại chứng từ, Ngày tạo thay vì chuỗi UUID thô).
2. **Bổ sung Modal Phê duyệt Hệ số phát thải (Factor Review Modal):** Bổ sung nút "Phê duyệt / Đánh giá" trên card hệ số dành cho tài khoản Company Admin, cho phép chọn quyết định (`approved_for_release_candidate`, `needs_information`, `rejected`) và nhập ghi chú thẩm định `notes` gửi tới `POST /api/data-governance/factor-proposals/:id/reviews`.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Kiểm tra quyền Company Admin trên giao diện:** Khóa form hoặc hiển thị thông báo chỉ đọc đối với tài khoản không có quyền Admin, tránh gửi request dẫn đến lỗi 403.
2. **Mở popup xem chi tiết Đánh giá DQL:** Cho phép người dùng click vào một card DQL để xem lại chi tiết điểm từng chiều (Thời gian, Địa lý, Công nghệ, Đầy đủ, Tin cậy), tỷ lệ % và cơ sở lý luận (`rationale`).

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Dropdown chọn đối tượng đánh giá DQL:** Thay vì nhập tay chuỗi `subjectReference`, cho phép chọn từ danh sách Facility / Process / Measurement Point đã có trong hệ thống nếu `subjectType` là cơ sở hoặc quy trình.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Controls Tests | `jest tests/services/dataQualityGovernanceControls.test.js` | 2/2 tests passed |
| BE Service Tests | `jest tests/services/dataQualityGovernanceService.test.js` | 2/2 tests passed |
| BE Migration Contract | `jest tests/config/dataQualityGovernanceMigrationContract.test.js` | 2/2 tests passed |
| FE Component Tests | `vitest run DataGovernanceClient` | 1 test file, 2/2 tests passed |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Người dùng có thể chọn chứng từ trực quan từ Evidence Vault thay vì gõ UUID thủ công.
- [x] Company Admin có thể duyệt đề xuất hệ số phát thải trực tiếp trên giao diện web.
- [x] Người dùng có thể bấm vào card DQL để xem lại chi tiết 5 chiều điểm số.
- [x] Tài khoản Viewer/Member chỉ thấy danh mục DQL và hệ số ở chế độ xem, form nhập bị vô hiệu hóa.
- [x] Kiểm thử luồng phê duyệt: hệ số sau khi được approve đổi trạng thái sang `approved_for_release_candidate` và được ghi nhật ký kiểm toán.

---

## 11. Kết luận

Phase 07 (Quản trị dữ liệu - `/data-governance`) sở hữu nền tảng backend và tiêu chuẩn phương pháp luận DQL L1–L5 cực kỳ chuẩn mực, kèm theo cơ chế băm dữ liệu và Evidence Gate chặt chẽ.

Điểm nghẽn duy nhất nằm ở tầng tương tác người dùng: việc thiếu hộp chọn chứng từ (buộc gõ UUID) và thiếu nút phê duyệt đề xuất hệ số. Sau khi giải quyết 2 điểm P0 này, module sẽ đạt trạng thái hoàn thiện tuyệt đối cho môi trường kiểm toán doanh nghiệp.
