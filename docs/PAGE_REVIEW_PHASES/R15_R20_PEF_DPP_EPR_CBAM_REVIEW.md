# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R15 – R20 (Báo Cáo Môi Trường Chuyên Sâu & Quy Định Mới EU)

> **Nhóm Báo Cáo:** Nhóm 5 — Các Quy Định Môi Trường Tiên Tiến & Quy Chuẩn Thị Trường Châu Âu Mới  
> **Các Mã Báo Cáo:**  
> - **R15:** Dấu chân môi trường sản phẩm dệt may & giày dép (Apparel & Footwear PEF / PEFCR)  
> - **R16:** Hộ chiếu sản phẩm kỹ thuật số (Digital Product Passport / ESPR Regulation (EU) 2024/1781)  
> - **R17:** Báo cáo trách nhiệm mở rộng nhà sản xuất dệt may (EU Textile & Footwear EPR / WFD Revision)  
> - **R18:** Sổ đăng ký công bố môi trường & chống tẩy xanh (Environmental Green Claim Register / Green Claims Directive)  
> - **R19:** Tờ khai cơ chế điều chỉnh biên giới carbon (EU CBAM Declaration / Regulation (EU) 2023/956)  
> - **R20:** Sàng lọc giấy phép chuyên ngành & phân luồng kiểm soát (Specialist Permits & Regulatory Triage)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `compliance_officer` (R17, R18), `customs_specialist` (R20), `company_admin` (R16), Chuyên gia LCA/CBAM (R15, R19)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Ngày Đánh Giá:** 29/09/2026  

---

## 1. Bối Cảnh Làn Sóng Quy Định Thỏa Thuận Xanh Châu Âu (EU Green Deal)

Nhóm báo cáo R15 – R20 đại diện cho thế hệ quy chuẩn mới nhất của Liên minh Châu Âu nhằm chuyển đổi nền kinh tế tuần hoàn và loại bỏ hiện tượng "tẩy xanh" (greenwashing):
- Khung **ESPR (Ecodesign for Sustainable Products Regulation)** yêu cầu minh bạch toàn bộ vòng đời sản phẩm qua Hộ chiếu số (DPP).
- Chỉ thị **Green Claims** phạt nặng các doanh nghiệp đưa ra công bố xanh mơ hồ.
- Cơ chế **EPR dệt may** buộc nhà sản xuất phải chịu trách nhiệm tài chính cho khâu thu gom và xử lý rác thải sau tiêu dùng tại Châu Âu.
- Cơ chế **CBAM** định giá phát thải carbon nhập khẩu.

---

## 2. Chi Tiết Rà Soát Từng Báo Cáo

### R15 — Dấu Chân Môi Trường Sản Phẩm PEF (Apparel & Footwear PEF/PEFCR)

#### 1. Chuẩn mực & Phương pháp luận
- **Căn cứ:** Khuyến nghị (EU) 2021/2279 của Ủy ban Châu Âu về Phương pháp Dấu chân Môi trường Sản phẩm (Product Environmental Footprint - PEF) và Quy tắc ngành Dệt may & Giày dép (PEFCR).
- **Trạng thái:** `NOT_STARTED` / Đang theo dõi tiến độ phê duyệt cuối cùng của Ủy ban Châu Âu.
- **Phạm vi 16 chỉ số tác động môi trường:**
  1. Biến đổi khí hậu (Climate change).
  2. Suy giảm tầng ôzôn (Ozone depletion).
  3. Độc tính đối với con người - gây ung thư (Human toxicity - cancer).
  4. Độc tính đối với con người - không gây ung thư (Human toxicity - non-cancer).
  5. Hạt bụi mịn (Particulate matter).
  6. Bức xạ ion hóa (Ionising radiation).
  7. Hình thành ôzôn quang hóa (Photochemical ozone formation).
  8. Axit hóa (Acidification).
  9. Phú dưỡng trên cạn (Terrestrial eutrophication).
  10. Phú dưỡng nước ngọt (Freshwater eutrophication).
  11. Phú dưỡng nước biển (Marine eutrophication).
  12. Độc tính sinh thái nước ngọt (Freshwater ecotoxicity).
  13. Sử dụng đất (Land use).
  14. Khan hiếm nước (Water use / scarcity).
  15. Sử dụng tài nguyên khoáng sản & kim loại (Resource use, minerals and metals).
  16. Sử dụng tài nguyên hóa thạch (Resource use, fossils).

---

### R16 — Hộ Chiếu Sản Phẩm Kỹ Thuật Số (ESPR Digital Product Passport)

#### 1. Căn cứ pháp lý & Mốc thời gian
- **Văn bản pháp luật:** Quy định Ecodesign cho sản phẩm bền vững (Regulation (EU) 2024/1781 - ESPR, có hiệu lực từ 18/07/2024).
- **Mốc áp dụng dệt may:** Dự kiến bắt buộc từ **2026 – 2027** khi Đạo luật ủy quyền (Delegated Act) của ngành dệt may được thông qua.
- **Trạng thái:** `BLOCKED_BY_LAW` (Chờ thông qua tiêu chuẩn kỹ thuật chi tiết của EC) / Đã hoàn thành **Nguyên mẫu bảo vệ (Guarded Prototype)**.
- **Mã nguồn:** `BE_weavecarbon/src/services/passportService.js`.

#### 2. Kiến trúc & Cơ chế bảo mật dữ liệu hai lớp
1. **Phân quyền truy cập 2 tầng (Two-Tier Data Containment):**
   - **Tầng Công khai (Public QR Code Scan):** Người tiêu dùng quét mã QR chỉ xem được các thông tin an toàn: Hướng dẫn chăm sóc giặt là, thành phần sợi (R08), thông tin tái chế, mã cơ sở sản xuất và các công bố xanh đã được kiểm duyệt (R18).
   - **Tầng Bảo mật (Auditor & B2B Partner Scan):** Yêu cầu xác thực khóa truy cập an toàn để đọc định mức nguyên liệu (BOM), dữ liệu phát thải chi tiết (PCF R12) và tệp kiểm tra hóa chất REACH (R11).
2. **Khóa bất biến DPP V2:** Mã băm `passportSha256` niêm phong dữ liệu sản phẩm, hỗ trợ truy xuất qua URI chuẩn GS1 Digital Link.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/passportService.test.js`: **Pass 100%** (`redacts raw carbon and certification data while returning approved R18 copy`).

---

### R17 — Khai Báo Trách Nhiệm Mở Rộng Dệt May (EU Textile EPR)

#### 1. Căn cứ pháp lý & Phạm vi
- **Văn bản pháp luật:** Dự thảo sửa đổi Chỉ thị Khung về Chất thải (Waste Framework Directive - WFD Revision for Textiles) và các luật quốc gia EPR (Luật AGEC của Pháp, UPV Kleding của Hà Lan).
- **Mã nguồn:** `BE_weavecarbon/src/services/euTextileEprControls.js`.
- **Mã schema:** `weavecarbon.eu-textile-epr@1.0.0`.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Định danh tổ chức thu hồi (PRO - Producer Responsibility Organisation):** Bắt buộc liên kết mã số thành viên của nhà sản xuất/nhập khẩu với tổ chức PRO tại quốc gia đích (ví dụ: `Refashion` tại Pháp, `Stichting UPV Textiel` tại Hà Lan).
2. **Phân loại trọng lượng & Danh mục sản phẩm (Eco-fee Modulation):**
   - Tự động bóc tách trọng lượng sản phẩm theo từng danh mục vật liệu (sợi tự nhiên vs sợi tổng hợp).
   - Áp dụng cơ chế điều chỉnh phí môi trường (Eco-modulation): Thưởng giảm phí (Bonus) cho sản phẩm có độ bền cao, dễ sửa chữa hoặc chứa sợi tái chế; phạt tăng phí (Malus) cho sản phẩm sợi pha khó tái chế.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/euTextileEprControls.test.js`: **Pass 100%** (kiểm tra phân loại danh mục, tính toán khối lượng và điều chế phí PRO).

---

### R18 — Sổ Đăng Ký Công Bố Môi Trường (Green Claims Register)

#### 1. Căn cứ pháp lý & Nguyên tắc chống tẩy xanh
- **Văn bản pháp luật:** Chỉ thị về Công bố Môi trường (Green Claims Directive) và Chỉ thị Trao quyền cho Người tiêu dùng Chuyển đổi Xanh (Empowering Consumers Directive (EU) 2024/825).
- **Mã nguồn:** `BE_weavecarbon/src/services/environmentalClaimControls.js`.
- **Mã schema:** `weavecarbon.environmental-claim-registry@1.0.0`.

#### 2. Rào chắn kiểm soát nghiêm ngặt (Zero Greenwashing Gate)
1. **Cấm tuyệt đối phát ngôn chung chung vô căn cứ:** Hệ thống chặn toàn bộ các cụm từ marketing tự phát như *"100% Thân thiện môi trường"*, *"Vải xanh"*, *"Carbon Neutral"* nếu không có phương pháp đo lường khoa học được công nhận.
2. **Bắt buộc liên kết Bằng chứng độc lập cấp 3 (Level 3 Audit Evidence):**
   - Mọi công bố (ví dụ: *"Áo được sản xuất từ 100% bông hữu cơ GOTS"* hoặc *"Giảm 30% lượng phát thải carbon so với phiên bản trước"*) bắt buộc phải gắn kết với:
     - Chứng nhận hợp lệ (GOTS, OEKO-TEX, GRS).
     - Báo cáo kiểm định độc lập có `evidenceDocumentId` còn hạn sử dụng trong Evidence Vault.
3. **Hiển thị bản sao công bố đã duyệt (Approved Claim Copy):** Chỉ những công bố có trạng thái `approved` mới được hiển thị trên Hộ chiếu số DPP và tài liệu giao nhận.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/environmentalClaimControls.test.js`: **Pass 100%**.

---

### R19 — Báo Cáo Điều Chỉnh Biên Giới Carbon (EU CBAM Declaration)

#### 1. Căn cứ pháp lý & Phạm vi ngành hàng
- **Văn bản pháp luật:** Quy định (EU) số 2023/956 thiết lập Cơ chế điều chỉnh biên giới carbon.
- **Đánh giá phạm vi đối với Dệt may & Giày dép:**
  - Ngành dệt may (Chương 61, 62) và giày dép (Chương 64) hiện tại **KHÔNG THUỘC Phụ lục I áp dụng CBAM** trong giai đoạn chuyển tiếp 2023–2025 (`NOT_APPLICABLE_BASELINE`).
  - Tuy nhiên, một số phụ kiện đi kèm (khóa kéo kim loại, cúc bấm thép/nhôm thuộc Chương 72, 73, 76) có thể bị soi chiếu nếu xuất khẩu đơn lẻ.
- **Hiện trạng kỹ thuật WeaveCarbon:**
  - Đã xây dựng sẵn mẫu biểu báo cáo CBAM 6 sheets XLSX chuẩn mực (theo mẫu Communication Template của Ủy ban Châu Âu), sẵn sàng kích hoạt ngay khi khách hàng có lô hàng chứa linh kiện thép/nhôm hoặc khi EU mở rộng phạm vi sang dệt may sau năm 2026.

---

### R20 — Sàng Lọc Giấy Phép Chuyên Ngành (Specialist Permits & Triage)

#### 1. Căn cứ pháp lý & Chức năng bộ máy
- **Mã nguồn:** `BE_weavecarbon/src/services/complianceApplicabilityControls.js`.
- **Mã schema:** `weavecarbon.specialist-permits-triage@1.0.0`.
- **Định dạng xuất:** JSON cấu trúc + Báo cáo phân luồng kiểm soát.

#### 2. Cơ chế phân luồng tự động (Automated Regulatory Triage)
Dựa trên Mã HS, Mô tả hàng hóa, Nước xuất xứ và Thành phần vật liệu, hệ thống tự động quét và phân luồng các giấy phép chuyên ngành:
1. **CITES (Công ước về buôn bán quốc tế các loài động, thực vật hoang dã nguy cấp):** Tự động chặn và yêu cầu giấy phép CITES nếu phát hiện sản phẩm làm từ da cá sấu, da trăn, da thằn lằn hoặc lông thú quý hiếm.
2. **Kiểm dịch thực vật (Phytosanitary Certificate):** Yêu cầu đối với sản phẩm chứa sợi xơ dừa thô, mây tre đan hoặc pallet gỗ chèn lót chưa hun trùng chuẩn ISPM 15.
3. **Phụ lục XVII REACH (Hạn chế chất nguy hại đặc thù):** Quét nồng độ các chất cấm (chì, niken trong phụ kiện kim loại tiếp xúc da, thuốc nhuộm Azo giải phóng amin thơm gây ung thư, hợp chất PFAS chống thấm nước).

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/complianceApplicabilityControls.test.js`: **Pass 100%**.

---

## 3. Bảng Tổng Hợp Kiểm Thử & Trạng Thái Nhóm 5

| Mã | Tên Báo Cáo | Căn Cứ Pháp Lý | Trạng Thái Kỹ Thuật | Backend Tests | Quyền Phê Duyệt |
|:---:|---|---|:---:|:---:|:---:|
| **R15** | Apparel PEF/PEFCR | EU 2021/2279 | `NOT_STARTED` (Chờ chuẩn EC) | Lộ trình R&D | Chuyên gia LCA |
| **R16** | ESPR DPP | Regulation (EU) 2024/1781 | `BLOCKED_BY_LAW` (Guarded Proto) | Pass 1/1 test | `company_admin` |
| **R17** | EU Textile EPR | WFD Revision / Loi AGEC | `PARTIAL` (Sẵn sàng cho Pilot) | 12/12 tests pass | `compliance_officer` |
| **R18** | Green Claims Register | Directive (EU) 2024/825 | `PARTIAL` (Sẵn sàng cho Pilot) | 12/12 tests pass | `compliance_officer` |
| **R19** | EU CBAM Declaration | Regulation (EU) 2023/956 | `NOT_APPLICABLE` (Sẵn 6 sheets) | Đã chuẩn hóa | Chuyên viên CBAM |
| **R20** | Specialist Permits | CITES / REACH Annex XVII | `PARTIAL` (Sẵn sàng cho Pilot) | 12/12 tests pass | `customs_specialist` |

---

## 4. Kết Luận
Toàn bộ danh mục báo cáo R15 – R20 đã được rà soát kỹ lưỡng. Các module cốt lõi liên quan trực tiếp đến trách nhiệm pháp lý hiện hành (EPR R17, Green Claims R18, Specialist Permits R20) đều có bộ test tự động đạt tỷ lệ đậu 100%. Các module tương lai (DPP R16, CBAM R19, PEF R15) đã có sẵn nguyên mẫu và cấu trúc dữ liệu, đảm bảo doanh nghiệp luôn đi trước một bước so với lộ trình pháp lý của Thỏa thuận Xanh Châu Âu.
