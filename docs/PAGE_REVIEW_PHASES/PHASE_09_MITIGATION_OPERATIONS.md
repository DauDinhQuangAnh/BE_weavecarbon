# Phase 09 - Rà soát trang Giảm phát thải và hạn ngạch (Mitigation Operations)

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Giảm phát thải & Quản lý Hạn ngạch (G2-04) |
| Route frontend chính | `/mitigation-operations` |
| Route demo tương ứng | `/demo/mitigation-operations` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_FOR_PILOT - Đã bổ sung chuyển trạng thái vòng đời sáng kiến, EvidenceSelector và role-gating Company Admin |
| Thay đổi code trong phase | Đã hoàn thành C2: Endpoint PATCH /initiatives/:id/lifecycle, modal chuyển trạng thái (in_progress, completed, cancelled) kèm lý do và audit trail, tích hợp EvidenceSelector |

---

## 2. Mục đích thực tế của trang

Trang `/mitigation-operations` đóng vai trò là sổ cái theo dõi kế hoạch giảm nhẹ phát thải (Mitigation Initiatives) và quản lý hạn ngạch / tín chỉ carbon (Allowance & Quota Ledger) của doanh nghiệp:

1. **Quản lý Sáng kiến giảm phát thải (Mitigation Initiatives):**
   - Đăng ký các đề xuất và dự án giảm phát thải gắn với từng cơ sở sản xuất (`facilityRevisionId`), năm cơ sở (`baselineYear`), mục tiêu giảm lượng phát thải (`targetReductionTco2e`), thời gian triển khai, phương pháp tính toán và tài liệu chứng minh.
   - Vòng đời sáng kiến: đề xuất (`proposed`), phê duyệt nội bộ (`approved_internal`), đang thực hiện (`in_progress`), hoàn thành (`completed`), hủy bỏ (`cancelled`).
2. **Xây dựng Kịch bản giảm phát thải (Mitigation Scenarios):**
   - Mô phỏng các kịch bản phát thải: Kịch bản cơ sở (`baseline`), Kịch bản kế hoạch (`planned`), Kịch bản thận trọng (`conservative`), Kịch bản căng thẳng (`stress`).
   - Tính toán mức giảm kỳ vọng (`expectedReductionTco2e = baselineEmissions - projectedEmissions`) và phân tích độ nhạy (`sensitivity`).
3. **Sổ cái Phân bổ Hạn ngạch (Allowance Allocation Ledger):**
   - Ghi nhận các công cụ phân bổ: Hạn ngạch do nhà nước cấp (`authority_quota`), Ngân sách carbon nội bộ (`internal_budget`), Tham chiếu chuyển nhượng (`transfer_reference`), Tham chiếu tín chỉ carbon (`credit_reference`).
   - Phân biệt trạng thái tham chiếu nháp (`draft_reference`) và đã xác thực bằng chứng (`evidence_confirmed`).
4. **Đánh giá Vị thế Hạn ngạch (Allowance Position Snapshot):**
   - Tổng hợp vị thế tuân thủ hạn ngạch của cơ sở bằng cách đối chiếu Kiểm kê phát thải thực tế (`Corporate GHG Inventory`) với Hạn ngạch được cấp (`allocations`) và Kịch bản giảm thiểu (`scenarios`).
   - Kiểm tra các rào chắn điều kiện (Readiness Blockers Gate) trước khi chốt báo cáo nội bộ.

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/mitigation-operations/page.tsx`
- `Weavecarbon/components/dashboard/mitigation-operations/MitigationOperationsClient.tsx`
- `Weavecarbon/components/dashboard/mitigation-operations/MitigationOperationsClient.test.tsx`
- `Weavecarbon/lib/mitigationOperationsApi.ts`
- `Weavecarbon/lib/industrialCoreApi.ts`
- `Weavecarbon/lib/weave-v2/corporateGhgInventoryApi.ts`

### Backend
- `BE_weavecarbon/src/routes/mitigationOperations.js`
- `BE_weavecarbon/src/services/mitigationOperationsService.js`
- `BE_weavecarbon/src/services/mitigationOperationsControls.js`
- `BE_weavecarbon/migrations/042_g2_mitigation_allowance_operations.sql`
- Tests:
  - `BE_weavecarbon/tests/services/mitigationOperationsControls.test.js`
  - `BE_weavecarbon/tests/services/mitigationOperationsService.test.js`
  - `BE_weavecarbon/tests/config/mitigationOperationsMigrationContract.test.js`

### Database & Bảng dữ liệu
- Bảng `mitigation_initiatives`: lưu sáng kiến, mục tiêu tCO₂e, phương pháp luận, bằng chứng và băm SHA-256 (`initiative_sha256`).
- Bảng `mitigation_scenarios`: lưu các kịch bản, dự báo phát thải hàng năm, mức giảm kỳ vọng và băm SHA-256 (`scenario_sha256`).
- Bảng `allowance_allocations`: sổ cái hạn ngạch/ngân sách carbon, năm vintage, mã tham chiếu ngoài, bằng chứng và băm SHA-256 (`allocation_sha256`).
- Bảng `allowance_positions`: vị thế rủi ro tuân thủ hạn ngạch, liên kết kiểm kê KNK, danh sách blockers và snapshot trạng thái.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Nguyên tắc cốt lõi: Không cấn trừ tự động phát thải tổng (No Gross Emission Netting)
- **Quy tắc quốc tế & Luật định:**
  Tại `mitigationOperationsControls.js` (dòng 12):
  > *"Allowances and credits are not netted from gross GHG inventory totals. Records do not prove registry ownership, eligibility, transfer, surrender or regulatory compliance."*
- **Ý nghĩa kiểm toán:** Hạn ngạch nhà nước cấp hoặc tín chỉ carbon mua ngoài tuyệt đối không được tự động trừ vào tổng lượng phát thải khí nhà kính trực tiếp (Gross GHG Emissions) của cơ sở. Việc bù trừ (offsetting/netting) nếu có chỉ được trình bày riêng trong báo cáo cân bằng hạn ngạch hoặc tuyên bố trung hòa carbon theo ISO 14068.

### 4.2. Rào chắn điều kiện Vị thế (Position Readiness Gate)
Hàm `positionReadiness` kiểm tra nghiêm ngặt 8 điều kiện:
1. `POSITION_INVENTORY_NOT_READY`: Dữ liệu kiểm kê KNK cơ sở chưa hoàn tất.
2. `POSITION_INVENTORY_REVIEW_REQUIRED`: Báo cáo kiểm kê chưa được duyệt nội bộ (`approved_for_internal_report`).
3. `POSITION_REPORTING_YEAR_MISMATCH`: Năm báo cáo của hạn ngạch không khớp năm kiểm kê.
4. `POSITION_FACILITY_ACTIVITY_REQUIRED`: Cơ sở chưa có dữ liệu đo đạc hoạt động.
5. `POSITION_ALLOCATION_REQUIRED`: Chưa khai báo bất kỳ hạn ngạch nào.
6. `POSITION_ALLOCATION_EVIDENCE_REQUIRED`: Tồn tại hạn ngạch chưa được xác thực chứng từ (`draft_reference`).
7. `POSITION_AUTHORITY_QUOTA_REQUIRED`: Bắt buộc phải có ít nhất một hạn ngạch do cơ quan nhà nước cấp (`authority_quota`).
8. `POSITION_SCENARIO_EVIDENCE_REQUIRED`: Kịch bản thiếu tài liệu bằng chứng.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Sáng kiến | Chọn Cơ sở & Nhập mục tiêu | Nhập tên sáng kiến, người phụ trách, mục tiêu tCO₂e. | Hoạt động tốt, kiểm tra số thực dương. |
| Sáng kiến | Ô "Tài liệu bằng chứng" | Nhập text phân cách dấu phẩy. | **P0: Input text bắt gõ UUID thủ công.** |
| Sáng kiến | Nút "Tạo sáng kiến mới" | Gọi `POST /api/mitigation-operations/initiatives`. | Hoạt động tốt, sinh mã băm SHA-256. |
| Sáng kiến | **Nút Chuyển trạng thái vòng đời** | **Không có trên giao diện.** | **P0: Không có cách nào chuyển sáng kiến từ `proposed` sang `in_progress` hoặc `completed`.** |
| Kịch bản | Chọn Sáng kiến & Nhập phát thải | Nhập phát thải cơ sở vs phát thải dự phóng. | Tự động tính chênh lệch `expectedReductionTco2e`. |
| Hạn ngạch | Phân loại công cụ & Trạng thái | Chọn `authority_quota`, `internal_budget`... | Đúng chuẩn nghiệp vụ. |
| Vị thế | Nút "Tạo vị thế tuân thủ" | Gọi `POST /api/mitigation-operations/positions`. | Hoạt động tốt, đánh giá blockers tự động. |
| Toàn trang | **Biểu đồ Cân bằng Hạn ngạch (Quota Balance)** | **Chưa có trên giao diện.** | **P1: Chưa có biểu đồ so sánh Gross Emission vs Total Quota để thấy Thừa / Thiếu hạn ngạch.** |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - 100% API backend gắn với `req.companyId`.
  - Mọi bản ghi Sáng kiến, Kịch bản, Hạn ngạch, Vị thế đều cô lập tuyệt đối theo công ty.
- **Phân quyền vai trò:**
  - Các thao tác tạo mới và tính toán vị thế đều yêu cầu `requireCompanyAdmin`.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh:**
   - Bảo toàn nguyên tắc minh bạch kiểm toán carbon: không tự ý cấn trừ tín chỉ vào phát thải thực tế.
   - Cơ chế băm SHA-256 cho toàn bộ sáng kiến và kịch bản giúp đảm bảo tính chống chối bỏ.
2. **Điểm cần khắc phục:**
   - Form có quá nhiều ô input yêu cầu nhập UUID thủ công gây ức chế và dễ lỗi cho người dùng.
   - Thiếu bảng thống kê cân đối trực quan (Balance Sheet) giữa hạn ngạch và phát thải thực tế.

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Thay thế Text Input UUID bằng Hộp chọn Danh mục:** Cung cấp modal chọn chứng từ từ Evidence Vault cho Sáng kiến & Hạn ngạch; cung cấp dropdown chọn Sáng kiến/Kịch bản cho form Vị thế.
2. **Bổ sung thao tác Chuyển đổi Vòng đời Sáng kiến (Initiative Lifecycle Controls):** Thêm nút thao tác trên từng card sáng kiến để Company Admin có thể cập nhật trạng thái (`in_progress`, `completed`, `cancelled`) kèm biên bản giải trình.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Bổ sung Biểu đồ / Thẻ Vị thế Hạn ngạch (Quota Balance Card):** Hiển thị rõ:
   - Phát thải thực tế: $E_{\text{gross}}$ (tCO₂e)
   - Hạn ngạch được cấp: $Q_{\text{quota}}$ (tCO₂e)
   - Chênh lệch vị thế: $\Delta = Q_{\text{quota}} - E_{\text{gross}}$ (Thừa hạn ngạch màu xanh / Thiếu hạn ngạch màu đỏ cần mua bổ sung).
2. **Việt hóa danh sách Blockers:** Chuyển đổi các mã blocker kỹ thuật (`POSITION_AUTHORITY_QUOTA_REQUIRED`, `POSITION_INVENTORY_REVIEW_REQUIRED`) thành thông báo tiếng Việt dễ hiểu.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Dự báo kịch bản phát thải đa năm:** Mở rộng form kịch bản cho phép nhập lộ trình cắt giảm qua từng năm (2026, 2027, 2028, 2030) thay vì chỉ một điểm mốc duy nhất.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Controls Tests | `jest tests/services/mitigationOperationsControls.test.js` | 3/3 tests passed |
| BE Migration Contract | `jest tests/config/mitigationOperationsMigrationContract.test.js` | 2/2 tests passed |
| BE Service Tests | `jest tests/services/mitigationOperationsService.test.js` | 2/2 tests passed |
| FE Component Tests | `vitest run MitigationOperationsClient` | 1 test file, 2/2 tests passed |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Người dùng có thể chọn chứng từ và hạn ngạch từ danh mục thay vì gõ UUID.
- [x] Admin có thể cập nhật trạng thái vòng đời của sáng kiến giảm phát thải.
- [x] Đảm bảo tính toán băm bất biến `initiative_sha256` và `allocation_sha256`.
- [x] Kiểm thử Quality Gate: nếu thiếu hạn ngạch nhà nước cấp (`authority_quota`), hệ thống từ chối xác nhận vị thế tuân thủ.

---

## 11. Kết luận

Phase 09 (Giảm phát thải & Hạn ngạch - `/mitigation-operations`) được xây dựng trên một triết lý kiểm toán rất chuẩn xác: bảo toàn lượng phát thải Gross và kiểm soát bằng chứng hạn ngạch chặt chẽ.

Sau khi cải tiến giao diện nhập liệu (thay UUID bằng bộ chọn) và bổ sung thẻ cân đối hạn ngạch trực quan, module sẽ đáp ứng trọn vẹn nhu cầu quản lý hạn ngạch phát thải cho các doanh nghiệp thuộc đối tượng kiểm kê bắt buộc tại Việt Nam.
