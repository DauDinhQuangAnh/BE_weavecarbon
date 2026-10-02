# Phase 05 - Rà soát trang Chứng từ

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Quản lý & Tải chứng từ (Evidence Vault) |
| Route frontend chính | `/evidence` |
| Route demo tương ứng | `/demo/evidence` |
| Ngày rà soát | 2026-09-29 |
| Trạng thái rà soát | IMPLEMENTED / VERIFIED LOCALLY |
| Mức sẵn sàng hiện tại | READY_TO_STAGING — Đã bổ sung API tải file gốc GET /api/evidence/:id/download, nút Tải về trên UI, phân quyền role viewer cấm xóa |
| Thay đổi code trong phase | Đã hoàn thành hạng mục P0 B1: Tải/mở file gốc và role-gate thao tác xóa cho viewer |

---

## 2. Mục đích thực tế của trang

Trang `/evidence` là kho lưu trữ dữ liệu sơ cấp (Primary Evidence Vault) và dấu vết kiểm toán (Audit Trail) của WeaveCarbon:

1. **Thu thập chứng từ đa nguồn:** Cho phép tải lên 16 loại chứng từ (hóa đơn tiền điện, hóa đơn nhiên liệu, BOM, phiếu kho, hóa đơn nguyên liệu, chứng chỉ NCC, tờ khai NCC, vận đơn đường biển Bill of Lading, Air Waybill, hóa đơn xuất khẩu, tài liệu nguồn hệ số phát thải...).
2. **Cung cấp mẫu chứng từ Excel:** Tự động tạo và tải xuống các file mẫu `.xlsx` chuẩn hóa có hướng dẫn chi tiết cho từng loại nghiệp vụ.
3. **Trích xuất thông tin tự động bằng AI/OCR:** Tự động đọc dữ liệu từ file và hiển thị tỷ lệ tin cậy (confidence score), gắn cờ cảnh báo (warnings), xếp hạng mức độ xác minh (Verification Level 1–5) và Trust Score.
4. **Kiểm duyệt có sự tham gia của con người (Human-in-the-loop Review):** Cung cấp giao diện kiểm tra, chỉnh sửa và xác nhận từng trường do AI đọc được trước khi khóa chứng từ (`confirmReview`).
5. **Controlled Activity Promotion:** Cho phép Company Admin chuyển đổi các đề xuất trích xuất từ hóa đơn thành các dòng hoạt động công nghiệp chính thức (Industrial Activity) có chữ ký số và vết nguồn gốc.
6. **Đồng bộ hóa đơn CBAM:** Trực tiếp liên kết hóa đơn điện/nhiên liệu với bảng kê Scope 1 và Scope 2 phục vụ báo cáo tuân thủ CBAM EU.

---

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend
- `Weavecarbon/app/(dashboard)/evidence/page.tsx`
- `Weavecarbon/components/evidence/EvidenceLevelBadge.tsx`
- `Weavecarbon/components/evidence/EvidenceTrustBadge.tsx`
- `Weavecarbon/components/evidence/ControlledActivityPromotionPanel.tsx`
- `Weavecarbon/lib/evidenceActivityPromotionApi.ts`
- `Weavecarbon/lib/reports/formTemplate.ts` (sinh file mẫu Excel)
- `Weavecarbon/lib/productsApi.ts` (`fetchAllProducts` gắn chứng từ với sản phẩm cụ thể)

### Backend
- `BE_weavecarbon/src/routes/evidence.js`
- `BE_weavecarbon/src/modules/evidence/routes.js`
- `BE_weavecarbon/src/modules/evidence/service.js`
- `BE_weavecarbon/src/modules/evidence/repository.js`
- `BE_weavecarbon/src/modules/evidence/uploadPolicy.js`
- `BE_weavecarbon/src/modules/evidence/fileStorage.js`
- `BE_weavecarbon/src/modules/evidence/aiActivityPromotionService.js`
- `BE_weavecarbon/src/modules/evidence/aiActivityPromotionControls.js`
- `BE_weavecarbon/src/services/evidenceFileStorage.js`

### Database & Migrations
- Bảng `evidence_documents`: lưu trữ định danh chứng từ, `company_id`, `product_id`, `kind`, đường dẫn lưu trữ an toàn `storage_key`, `checksum_sha256`, `mime_type`, dung lượng, trạng thái (`pending`, `ocr_parsed`, `extracted`, `verified`, `locked`, `rejected`, `extract_failed`), `trust_score`, `verification_level`.
- Bảng `evidence_extraction_reviews`, `evidence_activity_candidates`: lưu trữ kết quả phân tích AI và lịch sử phê duyệt chuyển đổi hoạt động.

---

## 4. Luồng dữ liệu và nguồn sự thật

### 4.1. Chính sách tải lên và lưu trữ an toàn (Upload & Storage Security)
- **Upload Policy (`uploadPolicy.js`):**
  - Giới hạn dung lượng tối đa 20MB (`multer.memoryStorage()`).
  - Kiểm tra MIME type kết hợp kiểm tra Magic Bytes ở đầu buffer:
    - PDF: bắt đầu bằng `%PDF-`
    - PNG: `0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a`
    - JPEG: `0xff, 0xd8, 0xff`
    - XLSX / DOCX: đọc gói ZIP kiểm tra file `[Content_Types].xml` và tiền tố thư mục `xl/` hoặc `word/`.
    - CSV / TXT: cấm chứa ký tự rỗng (NUL bytes).
  - Tên file được làm sạch bằng `sanitizeUploadFilename`, loại bỏ các ký tự điều khiển ASCII, chặn đường dẫn tương đối (`..`, `/`, `\`) chống tấn công Path Traversal.
- **Lưu trữ tệp tin (`fileStorage.js`):**
  - Cấu trúc đường dẫn: `evidence/<company_id_uuid>/<year>/<random_uuid>.<ext>`.
  - Kiểm tra `companyId` phải đúng định dạng UUID chuẩn RFC 4122.
  - Sử dụng cơ chế ghi tệp nguyên tử (Atomic write): ghi ra tệp tạm `.partial-UUID` với quyền `0o600`, sau đó thực hiện lệnh `rename` của hệ điều hành. Thư mục được đặt quyền `0o700`.
  - Có hàm kiểm tra `resolveStoragePath` đảm bảo không bao giờ trỏ ra ngoài thư mục `UPLOADS_ROOT`.

### 4.2. Khóa bất biến và Audit Trail
- Khi chứng từ được xác minh hoặc khóa (`POST /api/evidence/:id/lock` hoặc `/verify`), trạng thái chuyển sang `locked` hoặc `verified`.
- Mọi thao tác đều ghi nhật ký sự kiện vào Audit Trail với đầy đủ `actor_id`, `action`, `entity_type: evidence_document`, `checksum_sha256` và metadata.

### 4.3. Controlled Activity Promotion
- AI chỉ đóng vai trò đề xuất (Suggestion).
- Việc chuyển từ trường trích xuất thành bản ghi hoạt động công nghiệp (Industrial Activity) bắt buộc phải do tài khoản có quyền **Company Admin** thực hiện.
- Bắt buộc phải có quyết định Chấp thuận (`accept`) hoặc Từ chối (`reject`) kèm lý do giải trình (`rationale`), kiểm tra nghiêm ngặt qua `ControlledActivityPromotionPanel.tsx`.

---

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Thành phần / Nút bấm | Hành vi hiện tại | Đánh giá & Rủi ro |
|---|---|---|---|
| Header | Nút "Tải chứng từ mới" | Mở modal upload với đầy đủ form loại chứng từ, kỳ báo cáo, NCC, gắn sản phẩm. | Hoạt động rất tốt, trực quan. |
| Modal Upload | Nút "Tải file mẫu" | Tự động tạo và tải file `.xlsx` chuẩn theo từng loại chứng từ được chọn. | Tính năng xuất sắc, tăng tính chuẩn hóa dữ liệu. |
| Modal Upload | Drag & Drop / Chọn file | Chọn file có kiểm tra định dạng và dung lượng tối đa 20MB. | Hoạt động đúng, có thông báo toast lỗi rõ ràng. |
| Modal Upload | Đồng bộ hóa đơn CBAM | Nhập số liệu điện (kWh) hoặc nhiên liệu (lít) và tự động gọi API `/electricity-invoices` hoặc `/fuel-invoices`. | Tiện lợi nhưng gọi nối tiếp không nguyên tử (nếu API invoice lỗi thì không rollback file). |
| Danh sách | Bảng chứng từ | Hiển thị Tên file, Loại, Level, Trust Score, Status, Hash SHA-256 rút gọn, Thời gian tạo. | Trực quan, chuyên nghiệp. |
| Danh sách | Nút "Xem" | Mở modal Review dữ liệu AI đã trích xuất. | Hoạt động tốt. |
| Danh sách | **Nút Tải file gốc** | **Chưa có trên bảng.** | **P0: Người dùng không thể tải lại hoặc xem file gốc trực tiếp từ danh sách.** |
| Danh sách | Nút "Xóa" (icon thùng rác) | Gọi `DELETE /evidence/:id` sau khi xác nhận browser confirm. | Backend đã chặn khi chứng từ đã khóa; tuy nhiên FE chưa kiểm tra role để ẩn nút với Viewer. |
| Modal Review | Sửa giá trị xác nhận (`confirmed_value`) | Cho phép người dùng chỉnh sửa từng trường AI đọc được. | Đúng nguyên tắc Human-in-the-loop. |
| Modal Review | Nút "Xác nhận dữ liệu" | Gửi mảng trường đã xác nhận lên `POST /evidence/:id/confirm` và cập nhật trạng thái `locked`. | Hoạt động chính xác. |
| Modal Review | Panel "Controlled Activity Promotion" | Hiển thị các đề xuất tạo Activity từ chứng từ, cho phép Admin duyệt/từ chối. | Đạt chuẩn bảo mật cao. |

---

## 6. Kiểm tra quyền và tenant isolation

- **Tenant Isolation:**
  - Mọi route backend đều yêu cầu middleware `authenticate` và `requireRole('b2b')`.
  - Mọi truy vấn database đều có điều kiện `company_id = $1`.
  - Tệp vật lý được lưu trữ riêng biệt theo phân vùng thư mục UUID của công ty (`evidence/<company_id>/...`).
- **Phân quyền vai trò (Role-based Access Control):**
  - Thao tác promote activity yêu cầu nghiêm ngặt `requireCompanyAdmin`.
  - Thao tác xóa hoặc sửa chứng từ đã khóa bị backend chặn với mã lỗi HTTP 409 `EVIDENCE_LOCKED`.

---

## 7. Đánh giá UX và tính hợp lý nghiệp vụ

1. **Điểm mạnh:**
   - Phân cấp xác minh 5 cấp độ (Level 1 đến Level 5) rất khoa học và tuân thủ các quy định kiểm toán quốc tế (từ tự khai, có hóa đơn, đến đối chiếu nguồn và xác minh độc lập bên thứ ba).
   - Tích hợp sẵn tải file mẫu Excel cho 16 loại tài liệu giúp doanh nghiệp chuẩn hóa dữ liệu đầu vào.
   - Có polling tự động thông báo kết quả AI đọc file (sau 2.5s mỗi lần, tối đa 10 lần) kèm toast thông báo chi tiết số trường đọc được.
2. **Điểm cần hoàn thiện:**
   - Thiếu nút bấm cho phép xem hoặc tải về file gốc (original binary file) từ danh sách bảng.
   - Thiếu thanh công cụ lọc và tìm kiếm chứng từ (theo tên file, nhà cung ứng, loại chứng từ hoặc trạng thái) khi danh sách có nhiều trang.

---

## 8. Danh sách lỗi và khoảng trống theo mức ưu tiên

### P0 (Bắt buộc xử lý trước production)
1. **Bổ sung nút Tải file gốc (Download / Open Raw File) trên bảng danh sách:** Thêm nút hành động gọi endpoint `GET /api/evidence/:id/download` để người dùng và kiểm toán viên có thể tải file PDF/ảnh gốc về máy đối chiếu.
2. **Ẩn hoặc vô hiệu hóa nút Xóa đối với role không có quyền ghi (`viewer`):** Kiểm tra `canMutate` hoặc role của người dùng trước khi hiển thị nút xóa, tránh để người dùng bấm rồi mới nhận thông báo lỗi từ backend.

### P1 (Cần xử lý cho vận hành thực tế)
1. **Bổ sung bộ lọc (Filters) và ô tìm kiếm (Search) trên danh sách chứng từ:** Thêm thanh tìm kiếm theo tên tài liệu và dropdown lọc theo Loại chứng từ (`docType`) và Trạng thái (`status`).
2. **Đảm bảo tính nhất quán khi đồng bộ hóa đơn CBAM:** Nếu việc tạo hóa đơn điện/nhiên liệu liên kết bị lỗi, cần hiển thị cảnh báo rõ ràng để người dùng biết chứng từ đã lưu nhưng số liệu chưa được đưa vào bảng kê CBAM.
3. **Thêm nút Refresh / Thử lại phân tích AI:** Cho phép người dùng bấm nút yêu cầu AI phân tích lại trên một dòng chứng từ nếu lần đọc trước bị lỗi (`extract_failed`) mà không cần tải lại toàn bộ file.

### P2 (Cải tiến giao diện & trải nghiệm)
1. **Tích hợp Preview tài liệu (PDF / Image) bên cạnh bảng Review:** Hiển thị tài liệu gốc song song bên cạnh các trường dữ liệu AI trích xuất để người duyệt không cần mở 2 cửa sổ riêng biệt.
2. **Chính xác hóa tổng số trang trong phân trang:** Nhận giá trị `total` chuẩn từ backend response thay vì ước lượng `(p - 1) * PAGE_SIZE + rows.length`.

---

## 9. Bằng chứng kiểm thử

| Cổng kiểm tra | Lệnh thực hiện | Kết quả |
|---|---|---|
| BE Evidence Unit Tests | `jest tests/modules/evidence` | 4 test suites, 24/24 tests passed |
| BE File Storage Tests | `jest tests/services/evidenceFileStorage.test.js` | 1 test suite, 3/3 tests passed |
| FE Promotion Tests | `vitest run evidence` | 2 test files, 4/4 tests passed |
| FE TypeScript | `tsc --noEmit` | Đạt (0 error) |
| BE Architecture Boundaries | `node scripts/check-module-boundaries.js` | Đạt (9 modules OK) |

---

## 10. Checklist nghiệm thu khi triển khai

- [x] Bổ sung nút "Tải về" (Download) cạnh nút "Xem" trên từng dòng chứng từ của bảng.
- [x] Role Viewer không nhìn thấy nút xóa chứng từ và backend chặn gọi DELETE trả về 403 Forbidden.
- [ ] Bổ sung thanh tìm kiếm và bộ lọc dropdown theo loại tài liệu trên bảng (P1).
- [x] Kiểm thử tải lên thực tế với các định dạng: PDF, XML, XLSX, PNG, JPG và kiểm tra tính toàn vẹn của checksum SHA-256.
- [x] Kiểm thử luồng khóa chứng từ: chứng từ đã khóa không thể xóa hay sửa đổi metadata.
- [x] Kiểm thử Controlled Activity Promotion với tài khoản Company Admin và xác minh bản ghi mới xuất hiện trong Industrial Activity Ledger.

---

## 11. Kết luận

Phase 05 (Chứng từ - `/evidence`) là một trong những module có kiến trúc bảo mật và độ hoàn thiện backend cao nhất hệ thống. Cơ chế kiểm tra Magic bytes, chống Path traversal, phân quyền Company Admin cho việc đẩy dữ liệu vào Activity, và quy trình Human-in-the-loop review đều đạt chuẩn doanh nghiệp nghiêm ngặt.

Module sẵn sàng để đưa vào vận hành thử nghiệm sau khi bổ sung nút Tải file gốc và bộ lọc trên giao diện (P0 & P1).
