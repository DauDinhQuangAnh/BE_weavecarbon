# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 16: Thanh Toán (/billing)

> **Mã Phase:** PHASE-16  
> **Tên Module:** Quản Lý Gói Dịch Vụ, Hạn Mức SKU & Tích Hợp Cổng Thanh Toán VNPay (Subscription Management, SKU Limits & VNPay Gateway Integration)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/billing/page.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/subscription.js`, `BE_weavecarbon/src/services/subscriptionService.js`, `BE_weavecarbon/src/middleware/subscriptionAccess.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/billing` là trung tâm quản trị gói dịch vụ (Subscription Tier), dung lượng sử dụng sản phẩm (SKU usage & limits), và kênh kích hoạt thanh toán trực tuyến qua cổng VNPay dành cho khách hàng doanh nghiệp B2B. Các chức năng chính gồm:
1. **Phân cấp gói dịch vụ (Plan Families):**
   - **Gói Trial (14 ngày):** Tự động kích hoạt khi doanh nghiệp đăng ký tài khoản mới; cho phép tính toán carbon cơ bản, vận chuyển nội địa và xuất báo cáo PDF thử nghiệm.
   - **Gói Standard (899k – 1.499k VND/tháng):** Gói trả phí linh hoạt cho phép mua thêm hạn mức sản phẩm theo 3 bậc: +20 SKU (899,000đ), +35 SKU (1,199,000đ), +50 SKU (1,499,000đ); mở khóa đầy đủ tính năng vận chuyển xuất khẩu và truy cập API.
   - **Gói Export (Doanh nghiệp 3M – 6M VND/tháng):** Phục vụ các tập đoàn xuất khẩu với đầy đủ tính năng tuân thủ US/EU (CBAM, REACH, GPSR), theo dõi circular credit, hỗ trợ kiểm toán chuyên sâu và tài khoản chăm sóc riêng.
2. **Theo dõi Hạn mức & Cảnh báo Hết hạn (SKU Limits & Expiration Watch):** Hiển thị số lượng SKU đang dùng so với hạn mức tối đa cho phép; gắn nhãn cảnh báo đỏ nổi bật khi gói dùng thử (Trial) hết hạn.
3. **Cổng thanh toán VNPay chuẩn hóa:** Tạo phiên thanh toán bảo mật với mã băm chữ ký SHA-512 (`vnp_SecureHash`), IP client hợp lệ (`x-forwarded-for`), và xử lý kết quả thông qua webhook IPN bất đồng bộ (idempotent IPN processing).

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/billing/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/billing/page.tsx): Giao diện hiển thị gói cước hiện tại, 3 thẻ so sánh tính năng (Trial, Standard, Export), modal chọn mua thêm SKU và điều hướng sang URL thanh toán VNPay.
- [`Weavecarbon/hooks/useSubscriptionLock.ts`](file:///D:/hoctap/WCB/Weavecarbon/hooks/useSubscriptionLock.ts): React Hook quản lý trạng thái khóa tính năng dựa trên gói hiện tại và ngày hết hạn trial.
- [`Weavecarbon/lib/subscriptionPlans.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/subscriptionPlans.ts): Phân loại họ gói cước và quy tắc hạn mức.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/subscription.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/subscription.js): Khai báo router lấy trạng thái thuê bao, khởi tạo phiên thanh toán nâng cấp (`/upgrade`), xử lý chuyển hướng trả về (`/vnpay-return`) và nhận webhook IPN (`/vnpay-ipn`).
- [`BE_weavecarbon/src/services/subscriptionService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/subscriptionService.js): Xử lý tính toán hạn mức SKU cộng dồn, kiểm tra idempotency của giao dịch thanh toán, tạo checksum VNPay HMAC-SHA512.
- [`BE_weavecarbon/src/middleware/subscriptionAccess.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/middleware/subscriptionAccess.js): Middleware chặn truy cập vào các tính năng nâng cao (ví dụ: tạo sản phẩm vượt hạn mức, xuất khẩu thị trường quốc tế) khi tài khoản chưa nâng cấp hoặc trial đã hết hạn.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Người dùng Doanh nghiệp]
       │
       │ 1. Chọn mua gói Standard (+20 SKU / +35 SKU / +50 SKU)
       ▼
[Frontend: billing/page.tsx]
       │
       ├─► 2. POST /api/subscription/upgrade { target_plan: 'standard', standard_sku_limit: 20, payment_provider: 'vnpay' }
       │
       ▼
[Backend: subscriptionService.js: createUpgradeSession()]
       │
       ├─► 3. Tạo bản ghi giao dịch thanh toán tạm thời (`pending`) trong `payment_transactions`
       ├─► 4. Sinh URL thanh toán VNPay kèm chữ ký `vnp_SecureHash` (HMAC-SHA512)
       │
       ▼
[Frontend chuyển hướng người dùng sang VNPay Gateway]
       │
       │ Khách hàng quét mã VNPAY-QR hoặc nhập thẻ ATM/Thẻ tín dụng
       ▼
[VNPay Server]
       │
       ├─► A. Gọi Webhook ngầm: GET /api/subscription/vnpay-ipn
       │      ├─► Xác minh chữ ký SHA-512 bí mật
       │      ├─► Kiểm tra Idempotency (giao dịch chưa từng xử lý thành công)
       │      ├─► Nâng hạn mức `sku_limit = sku_limit + 20` trong bảng `subscriptions`
       │      └─► Trả về { RspCode: '00', Message: 'Confirm Success' }
       │
       └─► B. Chuyển hướng trình duyệt người dùng về: GET /api/subscription/vnpay-return
              └─► Redirect về FE: `/overview?payment_success=true&sku_limit=...`
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `subscriptions`: Lưu trạng thái gói, ngày kích hoạt, ngày hết hạn và hạn mức SKU hiện tại của tổ chức.
- Bảng `payment_transactions`: Lưu lịch sử toàn bộ các giao dịch thanh toán, mã tham chiếu ngân hàng, mã giao dịch VNPay và trạng thái xác nhận.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-BIL-01** | Quyền Quản trị Công ty | Chỉ người dùng có vai trò Quản trị viên (`requireCompanyAdmin`) mới có quyền kích hoạt giao dịch nâng cấp gói | `403 Forbidden` (`FORBIDDEN_ADMIN_REQUIRED`) |
| **CTL-BIL-02** | Xác minh Chữ ký VNPay | Toàn bộ tham số nhận được trong IPN/Return bắt buộc phải khớp với chữ ký mã hóa HMAC-SHA512 của hệ thống | `400 Bad Request` (`INVALID_CHECKSUM`) |
| **CTL-BIL-03** | Tính Bất Độc Giao Dịch (Payment Idempotency) | Một mã giao dịch (`vnp_TxnRef`) chỉ được kích hoạt nâng hạn mức đúng 1 lần; các yêu cầu IPN trùng lặp phải trả về kết quả thành công mà không cộng dồn hạn mức hai lần | Trả về `RspCode: '02'` (Order already confirmed) |
| **CTL-BIL-04** | Kiểm tra Thời hạn Dùng thử (Trial Lock) | Khi `trialExpired = true`, middleware chặn các tác vụ ghi mới (sản phẩm, tính toán, xuất khẩu) | `403 Forbidden` (`TRIAL_EXPIRED`, trả về cờ yêu cầu nâng cấp) |
| **CTL-BIL-05** | Hạn mức Sản phẩm (SKU Enforcement) | Không cho phép tạo mới sản phẩm nếu tổng số lượng SKU hiện có $\ge$ `sku_limit` đã mua | `403 Forbidden` (`SKU_LIMIT_EXCEEDED`) |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn truy cập:**
  - `SUBSCRIPTION_VIEW`: Tất cả thành viên trong tổ chức đều có thể xem gói cước hiện tại và số SKU đã sử dụng.
  - `SUBSCRIPTION_MANAGE`: Chỉ Owner / Company Admin mới có quyền tạo phiên thanh toán nâng cấp.
- **Ranh giới Multi-Tenancy:**
  - `req.companyId` được gắn chặt vào metadata của phiên thanh toán (`metadata.company_id`).
  - Webhook IPN đọc `company_id` từ cơ sở dữ liệu dựa trên mã giao dịch đã lưu, loại bỏ nguy cơ bên thứ ba gửi IPN giả mạo để cộng hạn mức cho tổ chức khác.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Hiển thị trực quan và minh bạch:** Thẻ gói dịch vụ hiện tại (Banner trên đầu) thể hiện số lượng SKU đã sử dụng trên tổng hạn mức (ví dụ `12 SKU đang sử dụng / 35 giới hạn`), giúp doanh nghiệp chủ động kế hoạch nâng cấp.
2. **Quy trình mua thêm SKU linh hoạt:** Modal chọn nhanh các mức +20, +35, +50 SKU với giá niêm yết rõ ràng bằng Việt Nam Đồng (VND).
3. **Cơ chế lưu trạng thái chờ (Pending Upgrade UX):** Frontend lưu thông tin gói chờ vào `sessionStorage` trước khi chuyển hướng sang VNPay, giúp trang `/overview` đón đầu kết quả và hiển thị thông báo chúc mừng mượt mà khi người dùng quay trở lại.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Xử lý xác thực chữ ký VNPay và bảo vệ Idempotency đã đạt tiêu chuẩn thanh toán ngân hàng.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Xuất hóa đơn VAT điện tử tự động:** Hiện tại hệ thống ghi nhận giao dịch thành công nhưng chưa tích hợp API xuất hóa đơn điện tử tự động (e-Invoice theo quy định Thông tư 78/2021/TT-BTC tại Việt Nam).

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Bổ sung lịch sử giao dịch và tải biên nhận trên trang Billing:** Cần thêm tab "Lịch sử hóa đơn & thanh toán" (Billing History) ngay dưới bảng chọn gói để kế toán công ty có thể xem lại các lần nạp và in sao kê.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/middleware/subscriptionAccess.test.js`
  - `BE_weavecarbon/tests/services/subscriptionService/paymentIdempotency.test.js`
  - `BE_weavecarbon/tests/services/subscriptionService/vnpay.test.js`
  - `BE_weavecarbon/tests/services/subscriptionService/planRules.test.js`
  - `BE_weavecarbon/tests/services/subscriptionService/helpers.test.js`
- **Kết quả thực thi:**
  - **5/5 test suites PASSED (100%)**
  - **49/49 tests PASSED (100%)**
  - Kiểm tra toàn diện quy tắc gói cước, thuật toán băm VNPay, chặn idempotency khi IPN gọi lại, và middleware khóa truy cập tài khoản khi hết hạn.

### 8.2. Frontend Tests
- Giao diện và API client subscription được xác thực qua việc kiểm tra cú pháp và tích hợp trong bộ test tổng thể.

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Hiển thị chính xác tên gói, số ngày trial còn lại, số SKU đang sử dụng và hạn mức tối đa.
- [x] Chặn tạo sản phẩm mới khi vượt quá hạn mức SKU của gói.
- [x] Khởi tạo phiên thanh toán VNPay đúng chữ ký HMAC-SHA512 và IP client.
- [x] Đảm bảo tính Idempotent tuyệt đối trong webhook xử lý IPN (không cộng dồn hai lần cho cùng một mã giao dịch).
- [x] Tự động cập nhật gói và hạn mức ngay sau khi thanh toán thành công.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Thanh toán `/billing` và quản lý thuê bao hoàn thiện vững chắc, cơ chế bảo vệ giao dịch và phân quyền đảm bảo an toàn doanh thu cho nền tảng SaaS.
- **Biên giới chưa xác minh:** Cần tiến hành chạy kiểm thử End-to-End với môi trường Sandbox thực tế của VNPay (sử dụng tài khoản thẻ ATM test của các ngân hàng NCB, Vietcombank) trong quá trình nghiệm thu trên môi trường Staging.
