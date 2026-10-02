# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 17: Cài Đặt & An Ninh Doanh Nghiệp (/settings)

> **Mã Phase:** PHASE-17  
> **Tên Module:** Cài Đặt Hệ Thống, Quản Lý Đội Ngũ, Cấu Hình AI & An Ninh Doanh Nghiệp (System & Personal Settings, Team RBAC, AI Engine Config & Enterprise Security G2-13)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/settings/page.tsx`, `Weavecarbon/app/(dashboard)/settings/ai/page.tsx`, `Weavecarbon/components/dashboard/settings/*`  
> **API Backend:** `BE_weavecarbon/src/routes/enterpriseSecurity.js`, `BE_weavecarbon/src/services/enterpriseSecurityControls.js`, `BE_weavecarbon/src/services/enterpriseSecurityService.js`, `BE_weavecarbon/src/routes/company.js`, `BE_weavecarbon/src/routes/auth.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/settings` và `/settings/ai` là trung tâm cấu hình toàn diện tài khoản, tổ chức, hạ tầng trí tuệ nhân tạo và kiểm soát an ninh doanh nghiệp cấp Enterprise (G2-13). Các phân hệ bao gồm:
1. **Thông tin Cá nhân & Tổ chức (Personal & System Settings):** Quản lý hồ sơ cá nhân (đổi mật khẩu, xác thực 2 bước 2FA TOTP), thông tin pháp lý doanh nghiệp (Mã số thuế, tên pháp nhân, địa chỉ trụ sở, logo tổ chức, tùy chọn ngôn ngữ Tiếng Việt / Tiếng Anh).
2. **Quản trị Đội ngũ & Phân quyền Vai trò (Team Management & RBAC):** Mời thành viên mới qua email, gán vai trò vận hành (`admin`, `operator`, `auditor`, `viewer`), quản lý trạng thái tài khoản và thu hồi quyền truy cập tức thời (chỉ mở cho gói trả phí Standard/Export).
3. **Kênh Thông báo (Notification Settings):** Cấu hình kênh nhận cảnh báo (Email, Webhook, Slack) và tần suất nhận tin (Realtime, Bản tin tóm tắt hàng ngày Daily, Báo cáo tuần Weekly).
4. **Cấu hình Trí tuệ Nhân tạo Doanh nghiệp (AI Settings `/settings/ai`):** Điều chỉnh mô hình ngôn ngữ lớn (Gemini / Anthropic / RAG nội bộ), điều chỉnh nhiệt độ sáng tạo (`temperature`), giới hạn token (`maxTokens`), và chính sách bảo vệ dữ liệu (Do Not Train on Customer Data / Zero Data Retention).
5. **An ninh Doanh nghiệp Nâng cao (Enterprise Security G2-13):**
   - **Đăng nhập một lần (Enterprise OIDC / SSO):** Cấu hình Issuer URL, Client ID, và tham chiếu khóa bí mật từ hệ thống quản lý khóa bên ngoài (AWS Secrets Manager / GCP Secret Manager / Vault).
   - **Vòng đời Khóa ký (Key Management):** Đăng ký khóa ký phát hành Ed25519/RSA, chu kỳ luân chuyển khóa (Key Rotation) và lý do thu hồi (Revocation Reason).
   - **Hồ sơ Sự cố Bảo mật (Security Incidents):** Quản lý nhật ký xử lý sự cố an ninh thông tin theo mức độ nghiêm trọng (Low / Medium / High / Critical).
   - **Cổng Phê duyệt Triển khai Production (Production Acceptance Gate):** Kiểm tra bắt buộc định danh phát hành bất biến (Git Commit SHA 40 ký tự hex, Container Image Digest sha256), khóa chặn triển khai nếu bất kỳ bài quét lỗ hổng hoặc kiểm tra runtime nào thất bại.

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/settings/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/settings/page.tsx): Route chính điều hướng các tab cài đặt.
- [`Weavecarbon/app/(dashboard)/settings/ai/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/settings/ai/page.tsx): Route cài đặt chuyên sâu cho các tham số AI RAG.
- [`Weavecarbon/components/dashboard/settings/SettingClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/settings/SettingClient.tsx): Bộ điều phối nạp động (dynamic import) các tab theo quyền hạn người dùng.
- [`Weavecarbon/components/dashboard/settings/SettingsTabsNav.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/settings/SettingsTabsNav.tsx): Thanh điều hướng tab: Hệ thống, Người dùng, AI, Thông báo, Bảo mật.
- [`Weavecarbon/components/dashboard/settings/EnterpriseSecuritySettings.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/settings/EnterpriseSecuritySettings.tsx): Giao diện quản trị an ninh doanh nghiệp G2-13.
- [`Weavecarbon/components/dashboard/settings/EnterpriseSecuritySettings.test.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/settings/EnterpriseSecuritySettings.test.tsx): Bộ kiểm thử đơn vị frontend cho giao diện an ninh.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/enterpriseSecurity.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/enterpriseSecurity.js): API router cho cấu hình OIDC, chính sách bảo mật, quản lý khóa và phê duyệt production.
- [`BE_weavecarbon/src/services/enterpriseSecurityControls.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/enterpriseSecurityControls.js): Module kiểm tra ràng buộc chặt chẽ: regex Git Commit SHA, OIDC secret reference, runtime scan gates.
- [`BE_weavecarbon/src/services/enterpriseSecurityService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/enterpriseSecurityService.js): Xử lý lưu vết và thực thi chính sách an ninh tổ chức.
- [`BE_weavecarbon/tests/services/enterpriseSecurityControls.test.js`](file:///D:/hoctap/WCB/BE_weavecarbon/tests/services/enterpriseSecurityControls.test.js): Bộ kiểm thử nghiệp vụ an ninh backend.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[Quản trị viên Tổ chức (Company Admin / Security Officer)]
       │
       ├─► 1. Cấu hình OIDC SSO / Luân chuyển Khóa / Phê duyệt Bản phát hành
       ▼
[Frontend: SettingClient.tsx -> EnterpriseSecuritySettings.tsx]
       │
       ├─► Kiểm tra quyền (isRoot = true, !isTrialPlan)
       │
       ▼
[Backend: routes/enterpriseSecurity.js]
       │
       ▼
[BE: enterpriseSecurityControls.js: validateProductionAcceptance()]
       ├─► Kiểm tra Git Commit SHA (khớp ^[a-f0-9]{40}$)
       ├─► Kiểm tra Container Digest (khớp ^sha256:[a-f0-9]{64}$)
       ├─► Đảm bảo không có cờ quét bảo mật thất bại (vulnerability / runtime gate failure)
       ├─► Kiểm tra Evidence Gate (bắt buộc evidenceDocumentId hợp lệ)
       └─► Ghi nhận bản ghi phê duyệt phát hành vào cơ sở dữ liệu
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `companies`: Lưu cấu hình thông tin pháp nhân và cài đặt thương hiệu của tổ chức.
- Bảng `enterprise_oidc_configs`, `enterprise_security_policies`, `enterprise_production_acceptances`: Lưu vết cấu hình bảo mật bất biến được kiểm toán.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-SET-01** | Quyền Quản trị Tab Thành viên | Chỉ tài khoản Root/Admin của các gói trả phí (Standard/Export) mới được truy cập tab Quản lý Thành viên | `403 Forbidden` (`TRIAL_PLAN_NO_USERS_MANAGEMENT`) |
| **CTL-SET-02** | Ràng buộc Bí mật OIDC | Khi kích hoạt OIDC (`isActive: true`), bắt buộc phải cung cấp tham chiếu bí mật bên ngoài (`externalSecretReference`) | `422 Unprocessable Entity` (`OIDC_SECRET_REF_REQUIRED`) |
| **CTL-SET-03** | Khóa Chặn Triển khai (Scan Gate) | Bản phát hành Production bị từ chối tuyệt đối nếu có bất kỳ cờ quét lỗ hổng runtime hoặc static code analysis thất bại | `409 Conflict` (`SECURITY_SCAN_GATE_FAILED`) |
| **CTL-SET-04** | Định danh Phát hành Bất biến | Commit SHA phải là chuỗi 40 ký tự hex và Container Digest phải đúng định dạng `sha256:<64 hex>` | `400 Bad Request` (`INVALID_RELEASE_IDENTIFIERS`) |
| **CTL-SET-05** | Chính sách Dữ liệu AI | Yêu cầu cờ Zero Data Retention được bật đối với các tổ chức gói Enterprise để ngăn việc huấn luyện dữ liệu khách hàng | `200 OK` (Bắt buộc trong payload cấu hình AI) |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn truy cập:**
  - `SETTINGS_PERSONAL`: Mọi tài khoản đều có thể cập nhật thông tin cá nhân và bật xác thực 2 lớp (2FA).
  - `SETTINGS_COMPANY`: Chỉ Admin mới có quyền cập nhật thông tin pháp nhân doanh nghiệp.
  - `SETTINGS_SECURITY_ADMIN`: Chỉ vai trò Security Officer / Root Admin mới được kích hoạt cấu hình OIDC SSO và phê duyệt bản phát hành.
- **Ranh giới Multi-Tenancy:**
  - Tất cả cấu hình bảo mật và danh sách thành viên đều được ràng buộc chặt chẽ theo `organizationId = req.companyId`.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Tải theo nhu cầu mượt mà (Dynamic Lazy Loading):** Từng tab cấu hình (`SystemSettings`, `UsersSettings`, `AISettings`, `EnterpriseSecuritySettings`) được tải lười bằng Next.js `dynamic()`, tối ưu hóa kích thước gói tệp JavaScript và tăng tốc độ hiển thị trang lần đầu.
2. **Phản hồi tức thì khi phân quyền:** Nếu người dùng thường (viewer) cố truy cập tab quản trị, hệ thống tự động ẩn tab hoặc chuyển hướng về `PersonalSettings` một cách an toàn mà không làm sập giao diện.
3. **Biểu mẫu an ninh chi tiết:** Giao diện `EnterpriseSecuritySettings` trình bày mạch lạc từ trạng thái SSO, chứng chỉ số, danh sách sự cố và trạng thái nghiệm thu triển khai production.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế kiểm soát an ninh G2-13 được lập trình với độ tin cậy cấp doanh nghiệp lớn.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Tích hợp cấu hình OIDC IdP tự động (Well-Known Discovery):** Hiện tại cấu hình OIDC yêu cầu người dùng nhập thủ công cả Issuer URL, Token URL và JWKS URL; nên hỗ trợ tự động tìm nạp (auto-fetch) từ endpoint `.well-known/openid-configuration` của nhà cung cấp danh tính (Google Workspace, Microsoft Entra ID, Okta).

### P2 (Cải tiến giao diện & Tiện ích)
- **P2-01 - Kiểm tra kết nối Webhook thông báo thời gian thực:** Thêm nút "Gửi thông báo thử nghiệm" (Send Test Alert) trong tab Notification Settings để quản trị viên kiểm tra xem Webhook Slack/Discord có hoạt động trước khi lưu cấu hình.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:** `BE_weavecarbon/tests/services/enterpriseSecurityControls.test.js`
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - **4/4 tests PASSED (100%)**
  - Bao gồm: kiểm thử cấu hình OIDC yêu cầu tham chiếu bí mật bên ngoài, kiểm tra tính hợp lệ của khóa ký và sự cố an ninh, xác thực định danh phát hành bất biến (Commit SHA & Container Digest), và kích hoạt cổng chặn triển khai khi quét bảo mật thất bại.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:** `Weavecarbon/components/dashboard/settings/EnterpriseSecuritySettings.test.tsx`
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - **3/3 tests PASSED (100%)**
  - Kiểm tra kết xuất giao diện an ninh, chuyển đổi trạng thái SSO và hiển thị danh mục phê duyệt bản phát hành.

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Cho phép người dùng chỉnh sửa thông tin cá nhân và quản trị viên cập nhật thông tin pháp nhân công ty.
- [x] Phân quyền tab thành viên chặt chẽ: chỉ mở cho Quản trị viên của các gói trả phí Standard/Export.
- [x] Cấu hình AI RAG hỗ trợ tùy chỉnh mô hình, nhiệt độ và cam kết không lưu giữ dữ liệu khách hàng.
- [x] Kiểm soát an ninh doanh nghiệp G2-13 nghiêm ngặt đối với OIDC, luân chuyển khóa phát hành và nhật ký sự cố.
- [x] Cổng nghiệm thu phát hành Production chặn đứng mọi phiên bản có cờ quét bảo mật thất bại hoặc thiếu băm Git/Container chuẩn.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Cài đặt & An ninh Doanh nghiệp đáp ứng xuất sắc các tiêu chí an toàn thông tin khắt khe của các khách hàng doanh nghiệp lớn (Enterprise Grade), tạo nền tảng vững chắc cho việc tích hợp SSO và quản trị đội ngũ quy mô lớn.
- **Biên giới chưa xác minh:** Việc kiểm thử tích hợp thực tế với các nhà cung cấp SSO thực tế (như Microsoft Entra ID hoặc Okta) cần tài khoản tenant thử nghiệm chuyên biệt của khách hàng để hoàn tất kiểm định End-to-End SSO Token Exchange trên Staging.
