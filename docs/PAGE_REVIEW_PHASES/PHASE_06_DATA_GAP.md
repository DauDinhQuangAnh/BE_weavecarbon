# Phase 06 - Rà soát trang Kiểm tra dữ liệu (Data Gap)

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Kiểm tra Khoảng trống Dữ liệu (Audit Readiness) |
| Route frontend chính | `/data-gap` |
| Route demo tương ứng | `/demo/data-gap` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_FOR_PILOT - Đã bổ sung Sửa, Xóa có kiểm soát vai trò và gắn chứng từ thực tế từ Evidence Vault |
| Thay đổi code trong phase | Đã hoàn thành B2 & B3: Modal chỉnh sửa, xóa có xác nhận, chặn viewer, gắn Evidence thật qua EvidenceSelector |

---

## 2. Mục đích thực tế của trang

Trang `/data-gap` đóng vai trò là bảng kiểm tra độ sẵn sàng kiểm toán (Audit Readiness Checklist) đối với 6 nhóm dữ liệu carbon nội bộ của doanh nghiệp:

1. **Đo lường độ đầy đủ hồ sơ:** Hiển thị điểm số sẵn sàng kiểm toán (`score` / 100), tỷ lệ dữ liệu đã xác minh nguồn (`primaryPct` %), tỷ lệ dữ liệu ước tính proxy (`proxyPct` %) và số lượng nhóm dữ liệu còn thiếu (`missingCount`).
2. **Khởi tạo danh mục kiểm tra mặc định (`seed`):** Tạo sẵn 6 nhóm dữ liệu thiết yếu thường gặp trong ngành dệt may và công nghiệp sản xuất (Dyeing supplier energy data, Diesel/thermal process evidence, Sea freight document, BOM and electricity invoice, GOTS certification, Scope 1 fuel emission factor verification).
3. **Quản lý danh sách khoảng trống dữ liệu:** Cho phép người dùng bổ sung các mục cần bổ sung chứng từ, phân loại trạng thái (`missing`, `proxy`, `self_declared`, `uploaded`, `verified`), mức độ rủi ro (`low`, `medium`, `high`), hành động cần thực hiện, người phụ trách và hạn chót hoàn thành.
4. **Cập nhật tiến độ xử lý:** Cho phép chuyển trạng thái một mục từ "Thiếu" sang "Đã tải lên" (`uploaded`).

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/data-gap/page.tsx`
- `Weavecarbon/app/demo/data-gap/page.tsx`
- Các components giao diện: Card, Badge, Dialog, Button, Select, Input từ `@/components/ui/`

### Backend
- `BE_weavecarbon/src/routes/dataGaps.js`
- `BE_weavecarbon/src/services/auditTrailService.js` (ghi vết nhật ký kiểm toán `data_gap.created`, `data_gap.updated`, `data_gap.verified`, `data_gap.seeded`)
- `BE_weavecarbon/migrations/007_supplier_requests_data_gaps_audit_trail.sql`

### Database & Bảng dữ liệu
- Bảng `data_gaps`: `id` (UUID), `company_id`, `data_group` (tên nhóm dữ liệu), `required_for_audit` (boolean), `current_status` (enum: `missing`, `proxy`, `self_declared`, `uploaded`, `verified`), `risk_level` (enum: `low`, `medium`, `high`), `required_action`, `owner`, `deadline`, `created_at`, `updated_at`.
- Bảng `supplier_requests`: lưu trữ yêu cầu cấp dữ liệu gửi tới nhà cung cấp liên kết với khoảng trống dữ liệu.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Cơ chế hoạt động Backend
- **Độc lập Tenant:** Mọi truy vấn `GET`, `POST`, `PUT`, `DELETE` trong `src/routes/dataGaps.js` đều ràng buộc theo `company_id = req.companyId`.
- **Sắp xếp theo rủi ro:** Danh sách trả về được ưu tiên sắp xếp:
  ```sql
  ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC
  ```
- **Idempotent Seed:** Endpoint `POST /api/data-gaps/seed` tự động kiểm tra các nhóm đã tồn tại trong company để tránh tạo trùng lặp.
- **Audit Logging:** Mọi hành động thêm, sửa, đổi trạng thái đều được ghi nhận vào `audit_trail` với `dataGroup`, `oldValue`, `newValue`.

### 4.2. Khoảng cách giữa lý thuyết kiểm toán và thực tế vận hành
- **Rủi ro "Checklist ảo":** 
  - Hiện tại, `/data-gap` hoàn toàn là một bảng biểu nhập tay độc lập. Khi người dùng bấm "Đã tải lên" (`markUploaded`), hệ thống chỉ thực hiện lệnh `UPDATE data_gaps SET current_status = 'uploaded'`, mà không liên kết tới bất kỳ tệp chứng từ nào trong bảng `evidence_documents` hay hóa đơn nào trong `electricity_invoices`.
  - Không có liên kết khóa ngoại (`evidence_id` hoặc `activity_id`). Điều này tiềm ẩn nguy cơ người dùng tự đánh dấu "Đã tải lên" hoặc "Đã xác minh" để gian lận điểm số Audit Readiness (từ 0 lên 100) mà thực chất không có bất kỳ file bằng chứng nào trên hệ thống.
- **Rủi ro "Thiếu dữ liệu = 0" (Data Absence vs Zero Activity):**
  - Cần cảnh báo rõ ràng rằng một khoảng trống dữ liệu không được phép ngầm hiểu là phát thải bằng 0. Khi dữ liệu sơ cấp thiếu, hệ thống bắt buộc phải áp dụng hệ số proxy có tính bù rủi ro (conservative penalty proxy) cho đến khi có chứng từ thật.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Header | Nút "Tạo checklist mặc định" | Hiển thị khi danh sách trống. Gọi `POST /api/data-gaps/seed` để chèn 6 nhóm dữ liệu chuẩn. | Hoạt động tốt, tiện lợi cho người dùng mới bắt đầu. |
| Header | Nút "Thêm mục mới" | Mở modal Dialog cho phép nhập tên nhóm, trạng thái, rủi ro, hành động, người phụ trách, hạn chót. | Hoạt động đúng, có validation cơ bản. |
| Modal | Nút "Lưu mục mới" | Gọi `POST /api/data-gaps`. Đóng modal và tải lại bảng. | Hoạt động tốt. |
| Bảng | Hiển thị các cột | Nhóm dữ liệu, Yêu cầu (Bắt buộc/Tùy chọn), Trạng thái, Mức rủi ro, Hành động yêu cầu, Phụ trách, Hạn chót. | Bố cục trực quan, màu sắc phân loại rủi ro rõ ràng. |
| Bảng | Nút "Đã tải lên" (icon Upload) | Gọi `PUT /api/data-gaps/:id` với `currentStatus: 'uploaded'`. | **P0: Chỉ cập nhật cờ DB, không thực sự tải file hay liên kết chứng từ.** |
| Bảng | **Nút Sửa / Xóa mục** | **Không có trên giao diện.** | **P0: Backend đã có sẵn `PUT` và `DELETE` nhưng FE không có nút sửa hay xóa dòng.** |
| Thẻ Metrics | Điểm độ đầy đủ hồ sơ (Score) | Tính tỷ lệ `(verified + uploaded) / total * 100`. | Dễ bị đánh lừa nếu người dùng bấm "Đã tải lên" khống. |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:** Đảm bảo 100% ở tầng Backend:
  - Mọi thao tác truy vấn đều có mệnh đề `WHERE id = $1 AND company_id = $2`.
  - Không có tình trạng đọc chéo dữ liệu giữa các công ty.
- **Role Permission:**
  - Route yêu cầu `requireRole('b2b')`.
  - Tuy nhiên, tương tự như các trang khác, giao diện chưa kiểm tra vai trò `viewer` để ẩn nút "Thêm mục mới" hoặc "Đã tải lên".

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm tốt:**
   - Trực quan hóa điểm số Audit Readiness với phân rã rõ ràng giữa dữ liệu đã xác minh nguồn (`primaryPct`) và dữ liệu ước tính (`proxyPct`).
   - Cảnh báo đầu trang nêu rõ: *"Việc tải tệp lên không đồng nghĩa dữ liệu đã được xác minh, phù hợp ISO hoặc được kiểm toán"*.
2. **Điểm cần khắc phục:**
   - Người dùng tạo nhầm một mục dữ liệu thì hoàn toàn không có cách nào xóa hoặc sửa lại nội dung trên giao diện (phải can thiệp database trực tiếp).
   - Nút "Đã tải lên" gây hiểu nhầm rằng người dùng có thể bấm vào để upload file, trong khi thực tế nó chỉ lập tức đánh dấu hoàn thành mà không mở hộp thoại chọn file.

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Thiếu nút Chỉnh sửa (Edit) và Xóa (Delete) trên giao diện:** Bổ sung modal chỉnh sửa và nút xóa dòng (gọi `DELETE /api/data-gaps/:id`) để người quản trị có thể điều chỉnh hoặc dọn dẹp các mục tạo sai.
2. **Liên kết nút "Đã tải lên" với luồng tải Chứng từ thực tế:** Thay vì chỉ cập nhật trạng thái khống, khi người dùng bấm vào hành động của dòng, cần mở hộp thoại Upload Evidence (hoặc điều hướng sang `/evidence` với ngữ cảnh gắn sẵn `dataGroup`), và chỉ chuyển trạng thái khi đã có ít nhất một file chứng từ được liên kết.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Bổ sung bộ lọc trạng thái và rủi ro:** Thêm tab/filter trên bảng để lọc theo: "Cần xử lý gấp (High Risk / Missing)", "Chờ xác minh", "Đã hoàn thành".
2. **Cảnh báo quá hạn (Overdue Warning):** Đánh dấu màu đỏ hoặc gắn badge "Quá hạn" đối với các mục có `deadline < now()` mà trạng thái vẫn là `missing` hoặc `proxy`.
3. **Phân quyền thao tác giao diện:** Khóa hoặc ẩn các nút thêm/sửa/xóa đối với tài khoản chỉ có quyền xem (`viewer`).

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Tích hợp tính năng gửi yêu cầu tới Nhà cung cấp (Supplier Request):** Tận dụng bảng `supplier_requests` đã có trong database để cho phép bấm "Gửi yêu cầu số liệu" trực tiếp cho NCC liên quan đến nhóm nguyên liệu/nhuộm còn thiếu.
2. **Tự động quét khoảng trống dữ liệu từ Hệ thống (Automated Gap Detection):** Thay vì chỉ dựa vào checklist thủ công, backend có thể quét định kỳ các lô hàng hoặc sản phẩm đã xuất bản nhưng thiếu hóa đơn Scope 1 hoặc Scope 2 để tự động sinh ra các mục Data Gap tương ứng.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Syntax Check | `node scripts/check-syntax.js` | Đạt (288 files checked, 0 syntax error) |
| BE Module Boundaries | `node scripts/check-module-boundaries.js` | Đạt (9 modules OK) |
| BE OpenAPI Check | `node scripts/check-openapi.js` | Đạt (352 operations OK) |
| FE TypeScript Typecheck | `tsc --noEmit` | Đạt (0 error) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Bổ sung icon/nút Sửa và Xóa trên từng dòng của bảng Data Gap.
- [x] Bổ sung hộp thoại xác nhận khi xóa mục kiểm toán.
- [x] Thay đổi luồng "Đã tải lên" để người dùng tải file chứng từ thực tế hoặc chọn chứng từ sẵn có trong Evidence Vault.
- [x] Kiểm thử với tài khoản Viewer: các nút chỉnh sửa bị ẩn hoặc làm mờ.
- [x] Kiểm thử Audit Trail: mọi thay đổi trạng thái đều sinh ra log tương ứng trong nhật ký kiểm toán.

---

## 11. Kết luận

Phase 06 hiện đóng vai trò như một bảng theo dõi công việc (To-do / Checklist) cho việc chuẩn bị kiểm toán carbon. Tầng cơ sở dữ liệu và route backend được thiết kế sạch sẽ, có bảo vệ tenant và ghi nhận audit trail đầy đủ.

Để trở thành công cụ kiểm soát chất lượng dữ liệu thực thụ, hệ thống cần xử lý 2 mục P0: bổ sung nút sửa/xóa và nối kết hành động giải quyết khoảng trống với việc tải chứng từ thực tế trong Evidence Vault.
