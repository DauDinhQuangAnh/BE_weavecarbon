# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 14: Nhật Ký Kiểm Toán (/audit-trail)

> **Mã Phase:** PHASE-14  
> **Tên Module:** Nhật Ký Kiểm Toán Bất Biến & Gói Tin Cậy Kiểm Toán (Immutable Audit Trail, Audit Bundle & Audit Trust Verification)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/audit-trail/page.tsx`, `Weavecarbon/components/audit/AuditPackClient.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/auditTrail.js`, `BE_weavecarbon/src/services/auditTrailService.js`, `BE_weavecarbon/src/modules/reports/auditBundle.js`, `BE_weavecarbon/src/modules/reports/auditTrust.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/audit-trail` là trung tâm giám sát tính toàn vẹn và bất biến (immutability) của toàn bộ dữ liệu phát thải, chứng từ và cấu hình vận hành trong tổ chức. Hệ thống đảm bảo:
1. **Nhật ký bất biến ghi nhận mọi biến động (Append-Only Audit Trail):** Tự động ghi nhận mọi thao tác phát sinh trong hệ thống: tạo/cập nhật/công bố sản phẩm (`product.*`), tải/xác minh chứng từ (`evidence.*`), quản lý chuỗi cung ứng (`supplier_request.*`), xử lý khoảng trống dữ liệu (`data_gap.*`), cập nhật vận đơn logistics (`shipment.*`), tạo và tải báo cáo (`report.*`).
2. **Phân tách luồng kiểm toán:**
   - **Nhóm Chứng từ & Evidence:** Theo dõi liên kết chứng từ pháp lý, hồ sơ nguồn gốc và băm SHA-256.
   - **Nhóm Lịch sử Điều chỉnh (Version Control):** Ghi lại giá trị cũ (`oldValue`), giá trị mới (`newValue`), lý do thay đổi (`reason`) và định danh người dùng thực hiện.
3. **Định danh người thao tác (Identity Attribution):** Tự động phân giải ID người dùng (`userId`) sang họ tên đầy đủ (`fullName`) thông qua danh bạ thành viên công ty, hiển thị rõ ràng người chịu trách nhiệm.
4. **Gói kiểm toán tin cậy & Chia sẻ có chữ ký (Audit Bundle & Trust Sharing):** Đóng gói hồ sơ kiểm toán có ký số băm, tạo liên kết chia sẻ tạm thời an toàn có thời hạn (Signed Sharing Link) cho kiểm toán viên bên thứ ba mà không cần cấp quyền truy cập tài khoản nội bộ.

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/audit-trail/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/audit-trail/page.tsx): Trang nhật ký kiểm toán chính của Dashboard với các thẻ chỉ số (Metrics cards: Tổng bản ghi, Evidence, Lịch sử điều chỉnh), bộ tìm kiếm toàn văn và bộ lọc theo loại hành động.
- [`Weavecarbon/components/audit/AuditPackClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/audit/AuditPackClient.tsx): Giao diện chuyên biệt cho kiểm toán viên kiểm tra tính hợp lệ của gói hồ sơ kiểm toán.
- [`Weavecarbon/lib/weave-v2/auditBundleApi.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/weave-v2/auditBundleApi.ts): API client cho dịch vụ đóng gói và xác minh audit bundle.
- [`Weavecarbon/lib/weave-v2/auditPackV2.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/weave-v2/auditPackV2.ts): Module dựng payload, băm dữ liệu và xuất file kiểm toán JSON/CSV.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/auditTrail.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/auditTrail.js): Router kiểm toán, hỗ trợ phân trang (offset/limit), lọc theo trường và tìm kiếm chuỗi.
- [`BE_weavecarbon/src/services/auditTrailService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/auditTrailService.js): Service cốt lõi `logAuditTrail()` dùng chung cho tất cả các controller khác trong hệ thống.
- [`BE_weavecarbon/src/modules/reports/auditBundle.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/modules/reports/auditBundle.js): Xử lý tổng hợp hồ sơ kiểm toán thành bundle nguyên khối.
- [`BE_weavecarbon/src/modules/reports/auditTrust.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/modules/reports/auditTrust.js): Quản lý liên kết chia sẻ có ký số HMAC/token và xác minh tính toàn vẹn.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Bất kỳ hành động nghiệp vụ (Upload Evidence, Edit Factor, Create Shipment)]
       │
       ▼
[Backend Services (e.g. evidenceService, productsService, dataGapService)]
       │
       │ Gửi lệnh log bất đồng bộ hoặc trong transaction:
       ├─► auditTrailService.logAuditTrail({ companyId, userId, dataGroup, changedField, oldValue, newValue, reason })
       │
       ▼
[Cơ sở dữ liệu: Bảng `audit_trail` (Chỉ INSERT, cấm UPDATE/DELETE)]
       │
       ▼
[Frontend: /audit-trail (page.tsx)]
       │
       ├─► GET /api/audit-trail?companyId={companyId}&limit=500
       ├─► GET /api/company-members (Phân giải userId -> fullName)
       └─► Hiển thị 2 bảng riêng biệt: "Chứng từ & Evidence" và "Lịch sử điều chỉnh"
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng cơ sở dữ liệu `audit_trail`: Bảng nhật ký append-only lưu vết toàn diện, không cho phép chỉnh sửa hoặc xóa bởi người dùng ứng dụng.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-AUD-01** | Bắt buộc Tenant Scope | Mọi truy vấn `GET /api/audit-trail` phải có `at.company_id = req.companyId` | `401 Unauthorized` / `403 Forbidden` (`NO_COMPANY_ACCESS`) |
| **CTL-AUD-02** | Giới hạn phân trang tối đa | `limit` mặc định là 100, tối đa không được vượt quá 500 bản ghi/lần | Giới hạn cứng `Math.min(limit, 500)` |
| **CTL-AUD-03** | Tính bất biến của bảng Audit | Không cung cấp bất kỳ API endpoint nào cho phép sửa (`PUT`/`PATCH`) hoặc xóa (`DELETE`) bảng `audit_trail` | Phương thức không hỗ trợ (`405 Method Not Allowed`) |
| **CTL-AUD-04** | Toàn vẹn gói Audit Bundle | Chữ ký số hoặc băm SHA-256 của bundle chia sẻ phải khớp chính xác với bản snapshot gốc | `400 Bad Request` (`AUDIT_BUNDLE_HASH_MISMATCH`) |
| **CTL-AUD-05** | Thời hạn liên kết Audit Trust | Liên kết chia sẻ có chữ ký cho bên ngoài phải bị từ chối nếu `expiresAt < Date.now()` | `403 Forbidden` (`AUDIT_SHARE_LINK_EXPIRED`) |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn truy cập:**
  - `AUDIT_VIEW`: Cho phép xem danh sách lịch sử kiểm toán của công ty (dành cho Quản trị viên, Compliance Officer, Kế toán trưởng).
  - Khách hàng không có quyền xem log của tổ chức khác, câu lệnh SQL luôn dùng tham số `$1 = req.companyId`.
- **Phân giải định danh an toàn:**
  - Nếu `changed_by` là `null` hoặc hệ thống tự động chạy cron job: Hiển thị actor là `System`.
  - Nếu `changed_by` là UUID hợp lệ: Tra cứu tên từ danh sách thành viên nội bộ; nếu người dùng đã rời tổ chức, hiển thị rút gọn 8 ký tự đầu của UUID để tránh lộ thông tin ngoài ý muốn.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Bộ đếm trực quan & Rõ ràng:** 3 thẻ thống kê trên đầu trang (Tổng bản ghi, Chứng từ & Evidence, Lịch sử điều chỉnh) giúp kiểm toán viên nắm bắt nhanh dung lượng thay đổi trong kỳ.
2. **Bảng phân loại chuyên biệt:** Tách riêng bảng theo dõi chứng minh thư viện file và bảng biến động giá trị giúp người xem không bị rối mắt giữa việc tải tệp và việc sửa tham số tính toán phát thải.
3. **Tra cứu tốc độ cao:** Bộ lọc tìm kiếm kết hợp tức thời giữa nhóm dữ liệu (`dataGroup`), ghi chú (`notes`), trường thay đổi (`changedField`) và giá trị mới (`newValue`).

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Bản ghi kiểm toán được bảo vệ tốt và cách ly tenant nghiêm ngặt.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Chuẩn hóa trường `old_value` và `new_value` dạng cấu trúc:** Một số service ghi nhận dữ liệu cũ/mới dạng chuỗi plain text thô, trong khi một số khác ghi chuỗi JSON stringify. Cần chuẩn hóa format JSON đồng nhất để hỗ trợ hiển thị dạng Diff trực quan (Side-by-side Diff Viewer) trên giao diện.

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Bổ sung bộ chọn khoảng thời gian (Date Range Filter):** Hiện tại trang chỉ lọc theo từ khóa và loại hành động (`actionFilter`). Cần bổ sung DatePicker (Từ ngày - Đến ngày) để kiểm toán viên dễ dàng lọc dữ liệu cho các kỳ kiểm kê năm tài chính (ví dụ FY2025, FY2026).

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/modules/reports/auditBundle.test.js`
  - `BE_weavecarbon/tests/modules/reports/auditTrust.test.js`
  - `BE_weavecarbon/tests/modules/reports/auditTrustService.test.js`
  - `BE_weavecarbon/tests/config/auditBundleMigrationContract.test.js`
  - `BE_weavecarbon/tests/config/auditBundleReviewMigrationContract.test.js`
  - `BE_weavecarbon/tests/config/auditPackSignedSharingMigrationContract.test.js`
- **Kết quả thực thi:**
  - **6/6 test suites PASSED (100%)**
  - **30/30 tests PASSED (100%)**
  - Kiểm tra hợp đồng cơ sở dữ liệu, luồng đóng gói bundle, cơ chế chia sẻ có chữ ký và kiểm toán toàn vẹn dữ liệu.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:**
  - `Weavecarbon/lib/weave-v2/auditBundleApi.test.ts`
  - `Weavecarbon/lib/weave-v2/auditPackV2.test.ts`
- **Kết quả thực thi:**
  - **2/2 test files PASSED (100%)**
  - **8/8 tests PASSED (100%)**

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Ghi nhận tự động và chính xác mọi biến động dữ liệu cốt lõi (sản phẩm, chứng từ, data gap, chuỗi cung ứng, logistics, báo cáo).
- [x] Bảng `audit_trail` là cơ chế append-only bất biến, không có quyền xóa hay chỉnh sửa bản ghi.
- [x] Đảm bảo cách ly đa khách thuê (`req.companyId`) tuyệt đối trong mọi truy vấn xem nhật ký.
- [x] Hỗ trợ tạo gói hồ sơ kiểm toán đóng gói (Audit Bundle) và chia sẻ liên kết có chữ ký bảo mật cho kiểm toán viên bên thứ ba.
- [x] Giao diện phân loại rành mạch giữa hồ sơ minh chứng (Evidence) và lịch sử điều chỉnh tham số.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Hệ thống Nhật ký Kiểm toán `/audit-trail` đạt tiêu chuẩn toàn vẹn cao, cung cấp cơ sở pháp lý và bằng chứng tin cậy phục vụ các đợt thanh tra carbon nội bộ cũng như kiểm định độc lập quốc tế.
- **Biên giới chưa xác minh:** Cơ chế lưu trữ log hiện tại nằm trực tiếp trong PostgreSQL cơ sở. Với các doanh nghiệp có quy mô hàng triệu giao dịch đo lường/năm, cần có kế hoạch archiving định kỳ đưa bản ghi cũ sang WORM storage (Write Once Read Many trên S3 Object Lock) để tối ưu chi phí và tăng cường độ bất biến pháp lý.
