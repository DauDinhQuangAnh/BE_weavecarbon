# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R08 – R11 (Nhãn Mác, An Toàn Sản Phẩm & Hóa Chất EU)

> **Nhóm Báo Cáo:** Nhóm 3 — Tem Nhãn Hàng Hóa, An Toàn Sản Phẩm & Kiểm Soát Hóa Chất Độc Hại  
> **Các Mã Báo Cáo:**  
> - **R08:** Nhãn thành phần sợi dệt may EU (EU Textile Fibre Composition Label / Regulation (EU) 1007/2011)  
> - **R09:** Nhãn thành phần vật liệu giày dép EU (EU Footwear Material Label / Directive 94/11/EC)  
> - **R10:** Hồ sơ kỹ thuật an toàn sản phẩm chung EU (GPSR Technical File / Regulation (EU) 2023/988)  
> - **R11:** Hồ sơ kiểm soát hóa chất có nguy cơ rất cao (REACH SVHC Dossier / Regulation (EC) 1907/2006)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `compliance_officer` (Chuyên viên tuân thủ chất lượng & ESG)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Ngày Đánh Giá:** 29/09/2026  

---

## 1. Bối Cảnh Pháp Lý Thị Trường Liên Minh Châu Âu (EU)

Đối với các nhà sản xuất thời trang, dệt may và giày dép Việt Nam xuất khẩu sang EU, bộ quy định R08 – R11 là **điều kiện tiên quyết để được phép lưu hành trên thị trường (Market Access Prerequisites)**. Bất kỳ sự thiếu sót hoặc sai lệch nào trên tem nhãn hoặc hồ sơ hóa chất đều có thể dẫn đến việc hàng hóa bị giữ lại tại cảng đến, phạt hành chính hoặc bị thu hồi khỏi toàn bộ thị trường 27 nước thành viên theo hệ thống cảnh báo nhanh Safety Gate (RAPEX).

---

## 2. Chi Tiết Rà Soát Từng Báo Cáo

### R08 — Nhãn Thành Phần Sợi Dệt May EU (EU Textile Fibre Label)

#### 1. Căn cứ pháp lý & Phạm vi
- **Văn bản pháp luật:** Quy định (EU) số 1007/2011 của Nghị viện và Hội đồng Châu Âu.
- **Mã nguồn:** `BE_weavecarbon/src/services/textileFibreLabelControls.js`.
- **Mã schema:** `weavecarbon.eu-textile-fibre-label@1.0.0`.
- **Định dạng xuất:** JSON cấu trúc + Bảng kê XLSX + Vector Label Preview.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Quy tắc Tổng tỷ lệ 100%:**
   - Tổng tỷ lệ phần trăm của các thành phần sợi dệt cấu tạo nên sản phẩm bắt buộc phải bằng chính xác **$100\%$**.
   - Sai số tính toán không được vượt quá $\pm 0.01\%$.
2. **Danh mục tên gọi sợi hợp lệ (Annex I Authorized Fibre Names):**
   - Tên gọi loại sợi bắt buộc phải thuộc danh mục Phụ lục I của Regulation 1007/2011 (ví dụ: `cotton`, `polyester`, `viscose`, `wool`, `elastane`, `linen`, `silk`).
   - Nghiêm cấm sử dụng các thuật ngữ thương mại không chính thống như *"spandex"* (phải dùng `elastane`), *"rayon"* (phải dùng `viscose` hoặc `modal`).
3. **Cảnh báo nguồn gốc động vật (Animal Origin Trigger):**
   - Tự động quét và kích hoạt cụm từ cảnh báo bắt buộc: *"Contains non-textile parts of animal origin"* (Chứa các bộ phận không dệt có nguồn gốc từ động vật) nếu sản phẩm có chi tiết da (leather patch), nút sừng, lông vũ hoặc nút ngọc trai/vỏ sò.
4. **Đa ngôn ngữ EU:** Hỗ trợ nhãn song ngữ/tam ngữ bắt buộc theo quy định của từng nước thành viên (tiếng Anh, tiếng Pháp, tiếng Đức, v.v.).

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/textileFibreLabelControls.test.js`: **Pass 100%** (kiểm tra tổng tỷ lệ 100%, tên sợi Annex I, và cờ cảnh báo nguồn gốc động vật).

---

### R09 — Nhãn Thành Phần Vật Liệu Giày Dép EU (Footwear Material Label)

#### 1. Căn cứ pháp lý & Phạm vi
- **Văn bản pháp luật:** Chỉ thị 94/11/EC của Nghị viện Châu Âu về dán nhãn vật liệu cấu thành các bộ phận chính của giày dép.
- **Trạng thái kỹ thuật:** `NOT_STARTED` / Quy hoạch schema và biểu tượng hình học (Pictograms).

#### 2. Quy tắc nghiệp vụ bắt buộc theo Chỉ thị 94/11/EC
1. **Phân loại 3 bộ phận vật lý độc lập:**
   - **Mặt trên (Upper):** Bề mặt bên ngoài của phần mũ giày gắn liền với đế.
   - **Lớp lót và đế trong (Lining and Insole):** Phần tiếp xúc trực tiếp với bàn chân.
   - **Đế ngoài (Outsole):** Phần đáy giày tiếp xúc với mặt đất, chịu lực mài mòn.
2. **Quy tắc ngưỡng 80% (The 80% Surface Area Rule):**
   - Với mỗi bộ phận, nếu một loại vật liệu (Da thuộc - Leather, Da có tráng phủ - Coated leather, Hàng dệt - Textiles, hoặc Vật liệu khác - Other materials) chiếm ít nhất **$80\%$** diện tích bề mặt (hoặc $80\%$ thể tích đối với đế ngoài), thì phải công bố đích danh loại vật liệu đó.
   - Nếu không có loại vật liệu nào đạt $80\%$, bắt buộc phải công bố thông tin là **hỗn hợp 2 loại vật liệu chính** tạo nên bộ phận đó.
3. **Biểu tượng hình học (Pictograms):** Cung cấp cả tên chữ viết và biểu tượng đồ họa tiêu chuẩn theo Phụ lục II Directive 94/11/EC.

---

### R10 — Hồ Sơ Kỹ Thuật An Toàn Sản Phẩm Chung EU (GPSR Technical File)

#### 1. Căn cứ pháp lý & Mốc thời gian
- **Văn bản pháp luật:** Quy định an toàn sản phẩm chung EU (General Product Safety Regulation - Regulation (EU) 2023/988).
- **Mốc hiệu lực bắt buộc:** **13/12/2024** (Bắt buộc với mọi sản phẩm tiêu dùng đưa vào EU).
- **Mã nguồn:** `BE_weavecarbon/src/services/gpsrTechnicalFileControls.js`.
- **Mã schema:** `weavecarbon.eu-gpsr-technical-file@1.0.0`.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Thực thể kinh tế chịu trách nhiệm tại EU (EU Responsible Person / Authorized Representative):**
   - Bắt buộc khai báo đầy đủ danh tính thực thể kinh tế tại EU: Tên pháp nhân, địa chỉ bưu chính thực tế tại lãnh thổ EU, và địa chỉ email/cổng liên lạc trực tuyến đang hoạt động.
   - Chặn phát hành nếu thiếu thông tin EU Responsible Person.
2. **Truy xuất nguồn gốc & Lô sản xuất (Batch Traceability):**
   - Mã lô hàng (`batchNumber`), số seri, kiểu dáng (`styleCode`) và ngày sản xuất phải được gắn kết với cơ sở nhà máy sản xuất đã đăng ký trong Industrial Core.
3. **Báo cáo đánh giá rủi ro & Kết quả thử nghiệm an toàn (Risk Assessment & Lab Tests):**
   - Kiểm tra các nguy cơ an toàn cơ lý (dây rút trên quần áo trẻ em theo chuẩn EN 14682), nguy cơ nghẹn nút, độ bền xé.
   - Bắt buộc liên kết các báo cáo thử nghiệm phòng lab (`evidenceDocumentId` từ phòng kiểm nghiệm đạt chuẩn ISO/IEC 17025).

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/gpsrTechnicalFileControls.test.js`: **Pass 100%**.

---

### R11 — Hồ Sơ Hóa Chất Độc Hại REACH SVHC (SVHC Dossier)

#### 1. Căn cứ pháp lý & Phạm vi
- **Văn bản pháp luật:** Quy định REACH (EC) số 1907/2006 (Điều 33 - Nghĩa vụ thông báo thông tin hóa chất trong sản phẩm) và Chỉ thị khung chất thải WFD (Cơ sở dữ liệu SCIP).
- **Mã nguồn:** `BE_weavecarbon/src/services/reachSvhcDossierControls.js`.
- **Mã schema:** `weavecarbon.eu-reach-svhc-dossier@1.0.0`.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Kiểm soát ngưỡng nồng độ 0.1% trọng lượng ($w/w$):**
   - Rà soát danh mục các chất có nguy cơ rất cao (Candidate List of Substances of Very High Concern - SVHC, cập nhật bởi ECHA 6 tháng/lần).
   - Nếu nồng độ của bất kỳ chất SVHC nào trong một bộ phận hoặc linh kiện (theo nguyên tắc *"Once an article, always an article"*) vượt quá **$0.1\%$ theo trọng lượng**, hệ thống tự động:
     - Đánh dấu trạng thái `svhc_present`.
     - Kích hoạt yêu cầu cung cấp tài liệu hướng dẫn an toàn (`safeUseInstructions`).
     - Khởi tạo hồ sơ khai báo mã định danh nộp vào Cơ sở dữ liệu SCIP của ECHA.
2. **Ràng buộc chứng nhận kiểm nghiệm độc lập:** Bắt buộc gắn kết kết quả thử nghiệm hóa học từ phòng kiểm nghiệm quốc tế (SGS, Intertek, TÜV, Bureau Veritas) trong Evidence Vault.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/reachSvhcDossierControls.test.js`: **Pass 100%**.

---

## 3. Bảng Tổng Hợp Kiểm Thử & Trạng Thái Nhóm 3

| Mã | Tên Báo Cáo | Căn Cứ Pháp Lý | Trạng Thái Kỹ Thuật | Backend Tests | Quyền Phê Duyệt |
|:---:|---|---|:---:|:---:|:---:|
| **R08** | EU Textile Fibre Label | Regulation (EU) 1007/2011 | `PARTIAL` (Sẵn sàng cho Pilot) | 16/16 tests pass | `compliance_officer` |
| **R09** | EU Footwear Material Label | Directive 94/11/EC | `NOT_STARTED` (Đã có quy tắc 80%) | Đang bổ sung | `compliance_officer` |
| **R10** | GPSR Technical File | Regulation (EU) 2023/988 | `PARTIAL` (Sẵn sàng cho Pilot) | 16/16 tests pass | `compliance_officer` |
| **R11** | REACH SVHC Dossier | Regulation (EC) 1907/2006 Art. 33 | `PARTIAL` (Sẵn sàng cho Pilot) | 16/16 tests pass | `compliance_officer` |

---

## 4. Kết Luận
Nhóm báo cáo R08, R10, R11 đã hoàn thiện mã nguồn kiểm soát, có bộ test hoàn chỉnh và đáp ứng đầy đủ các rào chắn kỹ thuật của thị trường EU. R09 đang được xây dựng dựa trên nguyên mẫu quy tắc 80% tương tự R08. Người dùng vai trò `compliance_officer` hoàn toàn có thể kiểm soát và phát hành các chứng từ này cho khách hàng EU trong đợt Pilot.
