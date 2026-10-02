# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R12 – R14 (Dấu Chân Carbon & Bằng Chứng Kiểm Toán)

> **Nhóm Báo Cáo:** Nhóm 4 — Tính Toán Dấu Chân Carbon & Đóng Gói Bằng Chứng Kiểm Toán  
> **Các Mã Báo Cáo:**  
> - **R12:** Hồ sơ dấu chân carbon sản phẩm (Product Carbon Footprint Dossier / ISO 14067:2018)  
> - **R13:** Báo cáo kiểm kê khí nhà kính doanh nghiệp (Corporate GHG Inventory Report / GHG Protocol & ISO 14064-1)  
> - **R14:** Gói hồ sơ kiểm toán đóng gói & Chứng thư cam đoan (Audit Pack Bundle & Assurance Statement)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `compliance_officer` (R12, R13) và `company_admin` (R14)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Ngày Đánh Giá:** 29/09/2026  

---

## 1. Vị Trí Chiến Lược Trong Báo Cáo Bền Vững & Kiểm Định Độc Lập

Nhóm R12 – R14 là **trái tim số liệu khoa học (Scientific Core)** của nền tảng WeaveCarbon:
- **R12 (PCF):** Tính toán phát thải ở cấp độ đơn vị sản phẩm cụ thể (Functional Unit: ví dụ $1$ chiếc áo khoác hoặc $1$ đôi giày thể thao), phục vụ yêu cầu giải trình của các nhãn hàng thời trang quốc tế và hộ chiếu sản phẩm số (DPP).
- **R13 (Corporate GHG):** Tính toán tổng phát thải ở cấp độ toàn bộ doanh nghiệp/nhà máy theo 3 phạm vi (Scope 1, Scope 2, Scope 3), phục vụ kiểm kê quốc gia theo Nghị định 06/2022/NĐ-CP và công bố thông tin ESG.
- **R14 (Audit Pack Bundle):** Đóng gói toàn bộ chứng từ, hợp đồng, hóa đơn điện lực và kết quả đo đạc thành tệp nén `.zip` niêm phong bất biến để cung cấp cho đơn vị thẩm tra độc lập bên thứ ba (Third-Party Assurance Auditor).

---

## 2. Chi Tiết Rà Soát Từng Báo Cáo

### R12 — Hồ Sơ Dấu Chân Carbon Sản Phẩm (PCF ISO 14067)

#### 1. Chuẩn mực & Phương pháp luận
- **Chuẩn mực quốc tế:** ISO 14067:2018 (Carbon footprint of products) và GHG Protocol Product Life Cycle Accounting and Reporting Standard.
- **Mã nguồn:** `BE_weavecarbon/src/services/pcfStudyControls.js`.
- **Mã schema:** `weavecarbon.pcf-study@1.0.0`.
- **Ranh giới hệ thống:** Từ cái nôi đến cổng nhà máy (Cradle-to-Gate), bao gồm:
  1. Khai thác & chế biến nguyên liệu thô (Raw material acquisition).
  2. Vận chuyển nguyên phụ liệu về nhà máy (Inbound transport).
  3. Quy trình sản xuất, cắt, may, nhuộm, giặt, hoàn thiện tại cơ sở (Manufacturing & Processing).
  4. Đóng gói phân phối (Packaging).

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Bảo tồn giá trị 0 thực tế:** Tuyệt đối không áp đặt sàn nhân tạo $0.01\text{ kg CO}_2\text{e}$; giữ nguyên giá trị 0 cho các chặng phát thải bằng không hoặc sử dụng $100\%$ năng lượng tái tạo tại chỗ.
2. **Cấp chất lượng dữ liệu (Data Quality Level - DQL L1–L5):** Mọi hệ số phát thải và số liệu hoạt động gắn kèm đều phải có điểm đánh giá DQL. Nếu tồn tại DQL cấp L1 hoặc L2, hệ thống tự động gắn cờ cảnh báo chất lượng dữ liệu.
3. **Phân rã khí nhà kính:** Báo cáo tách biệt lượng phát thải hóa thạch ($CO_2\text{ fossil}$), phát thải sinh học ($CO_2\text{ biogenic}$), và lượng hấp thụ lưu trữ carbon.
4. **Phân định ranh giới công bố:** Đánh dấu rõ ràng là **Hồ sơ nghiên cứu nội bộ (`INTERNAL_ONLY`)**; cảnh báo không được sử dụng để tuyên bố so sánh công khai (Comparative Assertions) trước công chúng khi chưa trải qua quy trình Phê bình độc lập (Critical Review) theo Điều 6.7 ISO 14067.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/pcfStudyControls.test.js`: **Pass 100%**.

---

### R13 — Báo Cáo Kiểm Kê Khí Nhà Kính Doanh Nghiệp (Corporate GHG)

#### 1. Chuẩn mực & Khung pháp lý
- **Chuẩn mực:** GHG Protocol Corporate Standard, ISO 14064-1:2018, Nghị định 06/2022/NĐ-CP và Quyết định 42/2026/QĐ-TTg của Thủ tướng Chính phủ.
- **Mã nguồn:** `BE_weavecarbon/src/services/corporateGhgInventoryControls.js`.
- **Mã schema:** `weavecarbon.corporate-ghg-inventory@1.0.0`.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Ranh giới tổ chức & Vận hành:** Xác lập rõ tiếp cận kiểm soát vận hành (`operational_control`) hoặc tỷ lệ vốn góp (`equity_share`).
2. **Phân định 3 Phạm vi phát thải (Scopes):**
   - **Scope 1 (Trực tiếp):** Đốt nhiên liệu cố định (lò hơi đốt than/dầu/biomass), đốt nhiên liệu di động (xe công ty), rò rỉ môi chất lạnh ($HFCs$).
   - **Scope 2 (Gián tiếp từ năng lượng):** Bắt buộc tính toán song song theo 2 phương pháp:
     - **Location-based:** Áp dụng hệ số phát thải lưới điện quốc gia Việt Nam (EF lưới điện do Bộ TN&MT công bố).
     - **Market-based:** Áp dụng theo hợp đồng mua bán điện trực tiếp (DPPA), chứng chỉ năng lượng tái tạo (I-REC) có hợp đồng và chứng từ đã khóa trong Vault.
   - **Scope 3 (Chuỗi giá trị gián tiếp):** Hạch toán tối thiểu các danh mục liên quan trực tiếp đến hàng mua sắm và vận tải giao nhận.
3. **Quy tắc bất khả xâm phạm về Bù trừ Carbon (Offset Exclusion Rule):**
   - Tuyệt đối **không được trừ gộp tín chỉ carbon / khoản bù trừ (carbon offsets/removals) vào tổng phát thải gộp** (Gross Emissions).
   - Tín chỉ carbon được hạch toán độc lập ở mục tài sản môi trường riêng biệt.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/corporateGhgInventoryControls.test.js`: **Pass 100%**.

---

### R14 — Gói Hồ Sơ Kiểm Toán Đóng Gói (Audit Pack Bundle & Signed Sharing)

#### 1. Bản chất & Cơ chế bảo chứng
- **Mã nguồn:** `BE_weavecarbon/src/services/auditTrailService.js`, các migration `021_r14_audit_pack_signed_sharing.sql`.
- **Định dạng:** Tệp nén bất biến `.zip` chứa:
  - Bản ghi kiểm kê tổng thể (XLSX, JSON).
  - Toàn bộ tệp bằng chứng gốc (hóa đơn tiền điện EVN, hóa đơn than/sinh khối, hợp đồng thu mua, phiếu cân hải quan) được trích xuất trực tiếp từ Evidence Vault.
  - Tệp kiểm tra mã băm SHA-256 đối soát (`manifest.sha256`).

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Chữ ký số & Khóa niêm phong bất biến:** Toàn bộ gói Bundle được băm SHA-256 (`bundleSha256`). Mọi thao tác chỉnh sửa sau khi khóa sẽ làm hỏng tính toàn vẹn của gói kiểm toán.
2. **Cơ chế chia sẻ có chữ ký điện tử an toàn (Signed Share Link):**
   - Cung cấp liên kết URL truy cập tạm thời cho kiểm toán viên độc lập (Auditor / Verification Body như BVC, SGS, TUV, DNV).
   - Liên kết tự động hết hạn sau 7 ngày hoặc có thể thu hồi tức thì (`revoked`).
   - Ghi nhật ký mọi lượt truy cập, IP tải xuống vào bảng `audit_trails`.
3. **Lưu vết chứng thư thẩm tra (Assurance Statement):** Khi kiểm toán viên hoàn tất xác minh, chứng thư cam đoan độc lập (`limited_assurance` hoặc `reasonable_assurance`) được ký duyệt và lưu trữ vĩnh viễn.

#### 3. Bằng chứng kiểm thử tự động
- `tests/modules/reports/auditBundle.test.js` & `auditTrust.test.js`: **Pass 14/14 tests (100%)**.

---

## 3. Bảng Tổng Hợp Kiểm Thử & Trạng Thái Nhóm 4

| Mã | Tên Báo Cáo | Căn Cứ Chuẩn Mực | Trạng Thái Kỹ Thuật | Backend Tests | Quyền Phê Duyệt |
|:---:|---|---|:---:|:---:|:---:|
| **R12** | PCF Study Dossier | ISO 14067:2018 | `INTERNAL_ONLY` (Sẵn sàng) | 9/9 tests pass | `compliance_officer` |
| **R13** | Corporate GHG Inventory | GHG Protocol / NĐ 06/2022 | `INTERNAL_ONLY` (Sẵn sàng) | 9/9 tests pass | `compliance_officer` |
| **R14** | Audit Pack Bundle | ISO 14064-3 / ISAE 3410 | `PARTIAL` (Sẵn sàng cho Pilot) | 14/14 tests pass | `company_admin` |

---

## 4. Kết Luận
Nhóm báo cáo R12, R13, R14 sở hữu nền tảng phương pháp luận khoa học vững chắc nhất hệ thống, hoàn toàn tương thích với các tiêu chuẩn kiểm toán ESG khắt khe của các tổ chức kiểm định quốc tế.
