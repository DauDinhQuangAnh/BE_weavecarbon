# WeaveCarbon Page Review Phases

Tài liệu này theo dõi quá trình rà soát từng trang của WeaveCarbon trước khi triển khai sửa đổi.

Kế hoạch thực hiện chi tiết, phạm vi route con, hệ thống backend và bằng chứng bắt buộc của từng phase được ghi tại [REVIEW_EXECUTION_PLAN.md](./REVIEW_EXECUTION_PLAN.md).

Backlog triển khai sau khi hoàn tất rà soát, cùng thứ tự kiểm tra R01–R20 và điều kiện chuyển trạng thái, được ghi tại [IMPLEMENTATION_BACKLOG.md](./IMPLEMENTATION_BACKLOG.md).

## Nguyên tắc làm việc

- Mỗi phase chỉ đánh giá một trang hoặc một nhóm route con thuộc cùng nghiệp vụ.
- Mỗi phase có một file Markdown độc lập.
- Mỗi phase bắt đầu bằng rà soát; khi được yêu cầu triển khai, các lỗi trong phạm vi phase được sửa và kiểm thử ngay trong cùng tài liệu.
- Trạng thái `REVIEWED / NOT IMPLEMENTED` nghĩa là đã có kết luận kỹ thuật nhưng chưa sửa code.
- Trạng thái `IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING` nghĩa là đã sửa và vượt kiểm tra cục bộ, nhưng chưa phải xác nhận production.
- Test hiện có chỉ là một phần bằng chứng; không được coi là xác nhận production nếu chưa kiểm thử giao diện, quyền, API và database thật.

## Danh sách phase

| Phase | Trang | Route chính | Trạng thái | Tài liệu |
|---|---|---|---|---|
| 01 | Vận hành carbon | `/carbon-operations` | IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING | [PHASE_01_CARBON_OPERATIONS.md](./PHASE_01_CARBON_OPERATIONS.md) |
| 02 | Sản phẩm | `/products` | IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING | [PHASE_02_PRODUCTS.md](./PHASE_02_PRODUCTS.md) |
| 03 | Logistics | `/logistics` | IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING | [PHASE_03_LOGISTICS.md](./PHASE_03_LOGISTICS.md) |
| 04 | Tính carbon | `/carbon-calculator` | REVIEWED / NOT IMPLEMENTED | [PHASE_04_CARBON_CALCULATOR.md](./PHASE_04_CARBON_CALCULATOR.md) |
| 05 | Chứng từ | `/evidence` | REVIEWED / NOT IMPLEMENTED | [PHASE_05_EVIDENCE.md](./PHASE_05_EVIDENCE.md) |
| 06 | Kiểm tra dữ liệu | `/data-gap` | REVIEWED / NOT IMPLEMENTED | [PHASE_06_DATA_GAP.md](./PHASE_06_DATA_GAP.md) |
| 07 | Quản trị dữ liệu | `/data-governance` | REVIEWED / NOT IMPLEMENTED | [PHASE_07_DATA_GOVERNANCE.md](./PHASE_07_DATA_GOVERNANCE.md) |
| 08 | MRV Việt Nam | `/vn-mrv` | REVIEWED / NOT IMPLEMENTED | [PHASE_08_VN_MRV.md](./PHASE_08_VN_MRV.md) |
| 09 | Giảm phát thải và hạn ngạch | `/mitigation-operations` | REVIEWED / NOT IMPLEMENTED | [PHASE_09_MITIGATION_OPERATIONS.md](./PHASE_09_MITIGATION_OPERATIONS.md) |
| 10 | Industry Packs | `/industry-packs` | REVIEWED / NOT IMPLEMENTED | [PHASE_10_INDUSTRY_PACKS.md](./PHASE_10_INDUSTRY_PACKS.md) |
| 11 | Rủi ro khí hậu | `/climate-risk` | REVIEWED / NOT IMPLEMENTED | [PHASE_11_CLIMATE_RISK.md](./PHASE_11_CLIMATE_RISK.md) |
| 12 | Vận hành WeaveNode | `/weavenode` | REVIEWED / NOT IMPLEMENTED | [PHASE_12_WEAVENODE.md](./PHASE_12_WEAVENODE.md) |
| 13 | Xuất khẩu và tuân thủ | `/export` | REVIEWED / NOT IMPLEMENTED | [PHASE_13_EXPORT_COMPLIANCE.md](./PHASE_13_EXPORT_COMPLIANCE.md) |
| 14 | Nhật ký kiểm toán | `/audit-trail` | REVIEWED / NOT IMPLEMENTED | [PHASE_14_AUDIT_TRAIL.md](./PHASE_14_AUDIT_TRAIL.md) |
| 15 | Nhà cung cấp | `/suppliers` | REVIEWED / NOT IMPLEMENTED | [PHASE_15_SUPPLIERS.md](./PHASE_15_SUPPLIERS.md) |
| 16 | Thanh toán | `/billing` | REVIEWED / NOT IMPLEMENTED | [PHASE_16_BILLING.md](./PHASE_16_BILLING.md) |
| 17 | Cài đặt | `/settings` | REVIEWED / NOT IMPLEMENTED | [PHASE_17_SETTINGS.md](./PHASE_17_SETTINGS.md) |
| 18 | Tổng quan | `/overview` | REVIEWED / NOT IMPLEMENTED | [PHASE_18_OVERVIEW.md](./PHASE_18_OVERVIEW.md) |
| 19 | Báo cáo | `/reports` | REVIEWED / NOT IMPLEMENTED | [PHASE_19_REPORTS.md](./PHASE_19_REPORTS.md) |

Các route chi tiết như lịch sử tính toán, assessment, CBAM report, passport dashboard, shipment tracking và trang chi tiết sẽ được đánh giá trong phase của trang cha tương ứng, tránh đếm trùng thành một sản phẩm độc lập.
