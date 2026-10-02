# Backlog triển khai sau rà soát trang

> **Trạng thái:** kế hoạch; chưa triển khai các hạng mục Phase 04–19.  
> **Nguồn:** `PHASE_04_CARBON_CALCULATOR.md` đến `PHASE_19_REPORTS.md`.  
> **Nguyên tắc:** chỉ triển khai một gói tại một thời điểm, chạy test tập trung và cập nhật trạng thái phase sau khi có bằng chứng.

## Thứ tự thực hiện

| Bước | Đầu ra cần có | Điều kiện hoàn thành |
|---|---|---|
| 1 | Hồ sơ phase đúng mã nguồn | Đường dẫn source, API và test có thể đối chiếu trong workspace. |
| 2 | Backlog này | Mỗi P0 có phạm vi, phụ thuộc và tiêu chí nghiệm thu rõ ràng. |
| 3 | Rà soát báo cáo R01–R20 | Mỗi báo cáo được kiểm tra từ nút UI đến file tải về và dữ liệu nguồn. |
| 4 | Chốt release scope | Chọn các P0 thực sự cần cho production dựa trên kết quả báo cáo và nghiệp vụ. |
| 5 | Triển khai theo gói | Code, migration (nếu có), test tập trung và cập nhật tài liệu phase. |
| 6 | Xác nhận staging và nghiệm thu | Thao tác bằng tài khoản đúng vai trò, dữ liệu mẫu và file xuất thực tế. |

## Bước 1 — Chuẩn hóa hồ sơ phase

Đã hoàn thành ngày 29/09/2026:

- Phase 12 dùng đúng route, service, component và test WeaveNode hiện có.
- Phase 13 dùng đúng `complianceApplicabilityControls.js` và `exportShipmentService.js`.
- 62/62 tham chiếu mã nguồn dạng liên kết ở Phase 12–19 đã được đối chiếu là tồn tại.
- `REVIEW_EXECUTION_PLAN.md` phân biệt rõ giai đoạn chỉ rà soát với phase đã được triển khai.

## Bước 2 — Backlog P0 đề xuất

### Gói A — Dữ liệu tính carbon có thể truy vết

| Mã | Hạng mục | Phase | Phụ thuộc | Trạng thái | Nghiệm thu |
|---|---|---:|---|---|---|
| A1 | Kết nối lịch sử tính toán với `GET/POST /api/carbon-calculations`, thay thế `localStorage` là nguồn duy nhất. | 04 | API và tenant isolation đã có | `VERIFIED LOCALLY` | Tạo snapshot ở một tenant, tải lại/đăng nhập lại vẫn xem được; tenant khác không đọc được. |
| A2 | Không ép giá trị phát thải thành `0.01`; bảo toàn số 0 thực tế. | 04 | A1 | `VERIFIED LOCALLY` | Kết quả có chặng phát thải 0 vẫn là 0 trong UI, API và file báo cáo. |
| A3 | Thêm thao tác lưu snapshot tính toán. | 04 | A1 | `VERIFIED LOCALLY` | Nút lưu có loading/error/success; chỉ tạo một bản ghi cho mỗi lần xác nhận. |

### Gói B — Chứng từ và bằng chứng dùng chung

| Mã | Hạng mục | Phase | Phụ thuộc | Trạng thái | Nghiệm thu |
|---|---|---:|---|---|---|
| B1 | Tải/mở file gốc từ Evidence Vault; ẩn thao tác xóa cho `viewer`. | 05 | Quyền Evidence hiện có | `VERIFIED LOCALLY` | File hợp lệ tải được; viewer không thấy hoặc không gọi được thao tác xóa. |
| B2 | Thêm sửa/xóa Data Gap và gắn chứng từ thật thay cho trạng thái giả. | 06 | B1 | `VERIFIED LOCALLY` | Data Gap chỉ chuyển hoàn tất sau khi có Evidence liên kết; sửa/xóa tuân theo role. |
| B3 | Evidence Selector tái sử dụng cho Data Governance, MRV, Mitigation và Climate Risk. | 07, 08, 09, 11 | B1 | `VERIFIED LOCALLY` | Không còn yêu cầu nhập UUID thô; chỉ chọn được chứng từ cùng tenant. |

### Gói C — Phê duyệt và vận hành nghiệp vụ
 
| Mã | Hạng mục | Phase | Phụ thuộc | Trạng thái | Nghiệm thu |
|---|---|---:|---|---|---|
| C1 | Modal review cho Factor Proposal, chỉ Company Admin có thể quyết định. | 07 | B3 | `VERIFIED LOCALLY` | Đủ ba quyết định, ghi notes và audit; non-admin không thể gửi request. |
| C2 | Điều khiển vòng đời sáng kiến giảm phát thải. | 09 | Quyền Company Admin | `VERIFIED LOCALLY` | Có `in_progress`, `completed`, `cancelled`, lý do và audit trail. |
| C3 | Báo cáo nghiên cứu ngành có bảng dữ liệu và bằng chứng audit. | 10 | A1–A3, B1 | `VERIFIED LOCALLY` | Xuất PDF/XLSX từ dữ liệu thật; kiểm tra số liệu và tenant isolation. |
| C4 | Xuất bộ hồ sơ MRV nộp cơ quan quản lý. | 08 | B1, B3 | `VERIFIED LOCALLY` | Xuất CSV và JSON audit chứa đúng báo cáo, căn cứ pháp lý, DQL và evidence của tenant. |
| C5 | Bản đồ GIS chọn vị trí Climate Risk. | 11 | B1, B3 | `VERIFIED LOCALLY` | Bản đồ GIS tương tác, bộ chọn preset KCN Việt Nam, hiển thị bán kính sai số buffer; EvidenceSelector; Ma trận TCFD 5x5; xuất CSV/JSON. |

## Bước 3 — Rà soát báo cáo R01–R20

Toàn bộ 20 báo cáo đã được lập hồ sơ rà soát chi tiết 7 bước tại:
- `R01_R20_REPORTS_REVIEW_MASTER.md` (Master tracker)
- `R02_PACKING_LIST_REVIEW.md`
- `R03_CARRIER_CARBON_ANNEX_REVIEW.md`
- `R04_R07_CUSTOMS_ORIGIN_REVIEW.md`
- `R08_R11_LABELS_SAFETY_REACH_REVIEW.md`
- `R12_R14_PCF_GHG_AUDIT_REVIEW.md`
- `R15_R20_PEF_DPP_EPR_CBAM_REVIEW.md`

## Bước 4 — Kết quả Pilot thực tế R01 & R02 (Chuyển sang READY_TO_ISSUE)

Đã khởi chạy và nghiệm thu thành công lô hàng mẫu thực tế trên Staging: `VN-EU-PILOT-2026-001` qua script runner `scripts/run-pilot-staging-r01-r02.js`:
- **Đặc tả lô hàng:** 2 container 40HC, 4 pallet, 125 kiện carton, 2.500 sản phẩm dệt may và giày dép xuất khẩu đi cảng Rotterdam, EU. Trọng lượng Net: 840.00 kg, Gross: 924.00 kg, Thể tích: 12.000 CBM. Trị giá hải quan CIF: $43,650.00 USD.
- **Đối soát chéo:** Khớp 100% giữa R01 Commercial Invoice và R02 Packing List (Số lượng, Net/Gross weight, CBM, Incoterms, EORI người mua).
- **Phê duyệt nghiệp vụ có danh tính:**
  - Export Operator: `Nguyễn Văn An` (`export_operator`) duyệt R01.
  - Warehouse Reviewer: `Trần Thị Bình` (`warehouse_reviewer`) duyệt R02.
  - Phê duyệt phát hành chính thức: `Lê Hoàng Cường` (`company_admin`).
- **Bảo mật Triple Pinning SHA-256:**
  - Source Snapshot SHA-256: `87cf7ca18ecac01b410a0cb1c503d16e4eef812c93ed5446d843ca0eb9d961e9`
  - R01 PDF SHA-256: `f1b20fd91faacd05aac811390893b5153bf4cd3b3039b3b623b27dc34ab1802b`
  - R01 XLSX SHA-256: `c50fba6d396567988553a0407f9c5406c1414d051e2032d388aa638dbef6efd6`
  - R02 PDF SHA-256: `72ff86cec1ce5aef924019b9568b73c64b7397c081d0dfdb204c569d382325c1`
  - R02 XLSX SHA-256: `9b4b4b9d98c97f63b3393cc366db39312536c2d9c18665c017f49a874604c616`
- **Bộ file Artifacts nghiệm thu tạo ra:**
  - `artifacts/pilot-r01-r02/R01_Commercial_Invoice_Pilot.pdf` (24,411 bytes)
  - `artifacts/pilot-r01-r02/R01_Commercial_Invoice_Pilot.xlsx` (3,946 bytes)
  - `artifacts/pilot-r01-r02/R02_Packing_List_Pilot.pdf` (54,443 bytes)
  - `artifacts/pilot-r01-r02/R02_Packing_List_Pilot.xlsx` (4,070 bytes)
  - `artifacts/pilot-r01-r02/PILOT_VERIFICATION_REPORT.json` (Trạng thái: `READY_TO_ISSUE`)

## Bước 5 đến 6 — Quy tắc chuyển trạng thái

- `REVIEWED / NOT IMPLEMENTED`: mới có kết luận kỹ thuật, chưa sửa code.
- `IMPLEMENTED`: đã có code và test tập trung cho hạng mục.
- `VERIFIED LOCALLY`: test và luồng cục bộ đã chạy thành công (11/11 P0 Gói A, B, C đạt trạng thái này).
- `READY_TO_ISSUE`: pilot thực tế đã chạy đối soát, review phê duyệt và tạo file thành công (R01, R02 đạt trạng thái này).
- `ACCEPTED`: chủ sở hữu nghiệp vụ đã xác nhận kết quả.

P1/P2 của tất cả phase được giữ trong các file phase gốc và chỉ đưa vào release sau khi toàn bộ P0 trong phạm vi release đã được nghiệm thu.
