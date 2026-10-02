# Hồ Sơ Rà Soát Chi Tiết Báo Cáo Xuất Khẩu & Tuân Thủ Quốc Tế R01 – R20

> **Dự án:** WeaveCarbon B2B Platform  
> **Tuyến Thương Mại Cơ Sở:** Việt Nam $\rightarrow$ Liên Minh Châu Âu (EU) / Hoa Kỳ (US)  
> **Ngành Hàng Trọng Tâm:** Dệt may (Mã HS Chương 61, 62) & Giày dép (Mã HS Chương 64)  
> **Ngày Lập Hồ Sơ:** 29/09/2026  
> **Tài Liệu Nguồn Căn Cứ:** `BE_weavecarbon/docs/EXPORT_REPORT_MASTER_TRACKER.md`, `IMPLEMENTATION_BACKLOG.md`  

---

## BẢNG TỔNG HỢP TRẠNG THÁI DANH MỤC R01 – R20

| Mã | Tên Báo Cáo / Chứng Từ | Vai Trò / Tính Chất Pháp Lý | Trạng Thái Kỹ Thuật | Người Phê Duyệt Chỉ Định | Định Dạng Xuất | Bằng Chứng Test |
|:---:|---|---|:---:|:---:|:---:|:---:|
| **R01** | Hóa đơn thương mại (Commercial Invoice) | Chứng từ thương mại cốt lõi | `READY_TO_ISSUE` | `export_operator` | PDF, XLSX | BE 38/38, FE 1/1, Pilot Done |
| **R02** | Bảng kê đóng gói (Packing List) | Chứng từ kho vận & kiểm soát kiện | `READY_TO_ISSUE` | `warehouse_reviewer` | PDF, XLSX | BE 38/38, FE 1/1, Pilot Done |
| **R03** | Chứng từ vận tải & Phụ lục Carbon (Carbon Annex) | Vận đơn hãng tàu (ngoại vi) + Phụ lục phát thải | `EXTERNAL_DOCUMENT` | `export_operator` | Carrier File + XLSX | BE 13/13 |
| **R04** | Bàn giao thông quan xuất khẩu VN (VNACCS Handoff) | Gói bàn giao đại lý hải quan Việt Nam | `PARTIAL` | `customs_specialist` | JSON, XLSX | BE 29/29 |
| **R05** | Bàn giao thông quan nhập khẩu EU (EUCDM Handoff) | Gói bàn giao người khai hải quan EU | `READY_TO_PILOT` | `customs_specialist` | JSON, XLSX | BE 29/29 |
| **R06** | Bộ dữ liệu hỗ trợ khai báo ICS2 (ENS Safety) | Bàn giao hãng vận chuyển nộp ICS2 | `PARTIAL` | `customs_specialist` | JSON, XLSX | BE 29/29 |
| **R07** | Bảng tính hỗ trợ xuất xứ EVFTA (Origin Workbook) | Hồ sơ chứng minh xuất xứ C/O Form EUR.1 | `PARTIAL` | `customs_specialist` | JSON, XLSX | BE 29/29 |
| **R08** | Nhãn thành phần sợi dệt may EU (Textile Fibre Label)| Tuân thủ Quy định dệt may EU 1007/2011 | `PARTIAL` | `compliance_officer`| JSON, XLSX | BE 16/16, FE 2/2 |
| **R09** | Nhãn vật liệu giày dép EU (Footwear Material Label)| Chỉ thị 94/11/EC (Mặt trên/Lót/Đế ngoài) | `NOT_STARTED` | `compliance_officer`| Đang xây dựng | Chưa có |
| **R10** | Hồ sơ kỹ thuật an toàn sản phẩm (GPSR Tech File) | Quy định an toàn chung EU 2023/988 | `PARTIAL` | `compliance_officer`| JSON, XLSX | BE 16/16, FE 2/2 |
| **R11** | Hồ sơ hóa chất độc hại REACH SVHC (SVHC Dossier) | Quy định REACH 1907/2006 (Art. 33 & SCIP) | `PARTIAL` | `compliance_officer`| JSON, XLSX | BE 16/16, FE 2/2 |
| **R12** | Hồ sơ dấu chân carbon sản phẩm (PCF ISO 14067) | Nghiên cứu PCF chuyên sâu theo đơn vị chức năng | `INTERNAL_ONLY` | `compliance_officer`| JSON, XLSX | BE 27/27, FE 2/2 |
| **R13** | Báo cáo kiểm kê GHG doanh nghiệp (Corporate GHG) | GHG Protocol Doanh nghiệp (Scope 1, 2, 3) | `INTERNAL_ONLY` | `compliance_officer`| JSON, XLSX | BE 27/27, FE 2/2 |
| **R14** | Gói hồ sơ kiểm toán có chữ ký (Audit Pack Bundle) | Gói bằng chứng kiểm định độc lập cấp 3 | `PARTIAL` | `company_admin` | ZIP, JSON, CSV | BE 30/30, FE 8/8 |
| **R15** | Dấu chân môi trường sản phẩm PEF (PEF/PEFCR) | Đánh giá 16 tác động vòng đời EU | `NOT_STARTED` | Chuyên gia LCA | Đang chờ chuẩn | Chưa có |
| **R16** | Hộ chiếu sản phẩm kỹ thuật số (ESPR DPP) | Khung Ecodesign ESPR (EU 2024/1781) | `BLOCKED_BY_LAW`| `company_admin` | JSON, QR Link | Guarded Proto |
| **R17** | Khai báo trách nhiệm mở rộng dệt may (EU Textile EPR)| Chỉ thị khung chất thải WFD EU | `PARTIAL` | `compliance_officer`| JSON, XLSX | BE 39/39, FE 2/2 |
| **R18** | Sổ đăng ký công bố môi trường (Green Claims) | Chỉ thị chống tẩy xanh Green Claims Directive | `PARTIAL` | `compliance_officer`| JSON, XLSX | BE 39/39, FE 2/2 |
| **R19** | Báo cáo điều chỉnh biên giới carbon (EU CBAM) | Quy định CBAM (EU) 2023/956 | `NOT_APPLICABLE` | Chuyên viên CBAM | XLSX 6 sheets | FE 3/3 |
| **R20** | Giấy phép & Sàng lọc quy định chuyên ngành | Phân luồng CITES, kiểm dịch, an toàn sinh học | `PARTIAL` | `customs_specialist` | JSON, XLSX | BE 39/39, FE 5/5 |

---

## CHI TIẾT RÀ SOÁT TỪNG NHÓM BÁO CÁO

---

### NHÓM 1: BỘ BA CHỨNG TỪ THƯƠNG MẠI & VẬN TẢI CỐT LÕI (R01 – R03)

#### R01 — Commercial Invoice (Hóa đơn thương mại xuất khẩu)
- **Nút UI:** Trên `ShipmentExportPortal.tsx`, thẻ `commercial_invoice` hỗ trợ tạo bản review PDF/XLSX, tải file và phát hành.
- **Request FE:** `generateShipmentExportDocument(shipmentId, 'commercial_invoice', format)`.
- **API & Service BE:** `BE_weavecarbon/src/services/exportShipmentService.js` và `exportDocumentPdf.js`.
- **Nguồn dữ liệu:** `export_shipment_profiles` (Invoice no, date, place, PO, Incoterms, currency, exporter, importer, consignee, delivery place, payment terms) kết hợp `export_shipment_lines` (SKU, style, size, color, lot, confirmed HS/CN, quantity, unit price, line value).
- **Kiểm soát nghiệp vụ:** Bắt buộc xác nhận mã HS (`hsCodeConfirmed = true`), kiểm tra EORI/VAT của người nhập khẩu tại EU, tính toán giá trị hải quan (`customsValueAmount`), hỗ trợ số lượng 4 số lẻ và đơn giá 6 số lẻ.
- **Tệp xuất thực tế:** PDF A4 Landscape vector (không tràn lề, tự động phân trang) và XLSX bản quyền.
- **Quyền duyệt & Phát hành:** Người duyệt `export_operator`; phát hành bất biến yêu cầu `company_admin` và khóa bằng 3 mã băm (`sourceSnapshotSha256`, `payloadSha256`, `fileSha256`).
- **Test:** Pass 38/38 unit tests tại `exportShipmentService.test.js` & `exportDocumentPdf.test.js`.

#### R02 — Packing List (Bảng kê đóng gói chi tiết)
- **Nút UI:** Thẻ `packing_list` trên `ShipmentExportPortal.tsx`.
- **Request FE:** `generateShipmentExportDocument(shipmentId, 'packing_list', format)`.
- **API & Service BE:** `exportShipmentService.js` và `exportDocumentPdf.js`.
- **Nguồn dữ liệu:** Phân cấp cây đóng gói Container $\rightarrow$ Pallet $\rightarrow$ Thùng carton (`export_package_records`, `export_containers`).
- **Kiểm soát nghiệp vụ:** Đối soát chặt chẽ $Gross \ge Net$; tổng Net thùng carton = tổng Net hàng hóa trên Invoice; 100% số lượng sản phẩm được phân bổ hết vào các kiện; kiểm tra giới hạn tải trọng container (`max_gross_mass_kg`).
- **Tệp xuất thực tế:** Bảng tính XLSX 14 cột Ledger (`Container`, `Seal`, `Pallet`, `Package`, `Marks`, `Net`, `Gross`, `Dimensions`, `CBM`, `Contents`) và PDF A4 Landscape với 6 khối chỉ số tổng hợp.
- **Quyền duyệt & Phát hành:** Bắt buộc vai trò `warehouse_reviewer`. Khóa checksum chống chỉnh sửa lén.
- **Test:** Đã kiểm thử nén ZIP, sinh PDF và đối soát dữ liệu nhiều container, pass 38/38 tests.

#### R03 — Carrier Transport Document & Carbon Annex (Chứng từ hãng tàu & Phụ lục Carbon)
- **Bản chất pháp lý:** Vận đơn (Bill of Lading / AWB / Sea Waybill) là chứng từ do hãng tàu/forwarder cấp; WeaveCarbon **không tự ý phát hành vận đơn giả lập**, mà tiếp nhận, xác minh tệp gốc và cấp kèm **Phụ lục phát thải Carbon (Carbon Annex)**.
- **Nút UI:** Mục tải lên chứng từ vận tải hãng tàu và nút sinh Carbon Annex.
- **API & Service BE:** `carrierDocumentControls.js` và migration `024_r03_carrier_document_controls.sql`.
- **Nguồn dữ liệu:** Dữ liệu hãng tàu (`issuerName`, `vesselName`, `voyageNumber`, `portOfLoading`, `portOfDischarge`, `containerNumbers`, `sealNumbers`) kết hợp snapshot tính toán phát thải của chuyến đi (`calculation_snapshots`, hệ số phát thải GWP, ranh giới tính toán).
- **Kiểm soát nghiệp vụ:** Kiểm tra định dạng số container (4 chữ cái + 7 chữ số ISO 6346); dung sai đối soát trọng lượng giữa B/L và Packing List không được vượt quá $\pm 1\%$; bắt buộc băm SHA-256 tệp gốc hãng tàu.
- **Tệp xuất thực tế:** Tệp scan gốc của hãng tàu được khóa trong Vault + Tệp XLSX Phụ lục Carbon độc lập có đóng dấu cảnh báo bản quyền.
- **Quyền duyệt:** `export_operator` xác nhận tính chân thực; `company_admin` ký phát hành.
- **Test:** Pass 13/13 tests tại `tests/services/carrierDocumentControls.test.js`.

---

### NHÓM 2: BÀN GIAO THÔNG QUAN & HỒ SƠ XUẤT XỨ (R04 – R07)

#### R04 — Vietnam Customs Broker Handoff (Bàn giao đại lý khai hải quan VN)
- **Bản chất:** Gói dữ liệu bàn giao kỹ thuật số chuẩn hóa (`weavecarbon.vn-export-broker-handoff@1.0.0`) cho đại lý hải quan để nhập liệu vào phần mềm VNACCS/VCIS (không gửi trực tiếp vào cổng Tổng cục Hải quan).
- **Kiểm soát:** Bắt buộc mã HS 8 chữ số Việt Nam; kiểm tra mã chi cục hải quan xuất khẩu; kiểm tra phương thức vận tải và tỷ giá ngoại tệ.
- **Định dạng:** JSON có cấu trúc + XLSX bảng kê.
- **Duyệt:** `customs_specialist`.

#### R05 — EU Import Declarant Handoff (Bàn giao người khai hải quan EU)
- **Bản chất:** Gói hồ sơ kỹ thuật số tham chiếu mô hình dữ liệu hải quan EU (EUCDM - EU Customs Data Model) phục vụ người nhập khẩu mở tờ khai SAD / H1 tại nước đến.
- **Kiểm soát:** Bắt buộc mã TARIC 10 số đã được xác nhận (`taricConfirmed = true`); kiểm tra mã ưu đãi thuế quan (Preference Code); kiểm tra mã EORI/VAT của người nhận.
- **Định dạng:** JSON EUCDM + XLSX.
- **Duyệt:** `customs_specialist`.

#### R06 — ICS2 Filing Handoff (Hỗ trợ khai báo an ninh hàng hóa vào EU)
- **Bản chất:** Bộ dữ liệu hỗ trợ nộp tờ khai tóm tắt nhập cảnh (ENS - Entry Summary Declaration) vào hệ thống kiểm soát hàng hóa nhập khẩu EU (ICS2 Release 2 & 3).
- **Kiểm soát:** Đối soát mã hàng cấp 6 số HS; phân định rành mạch Master Air Waybill (MAWB) / House Air Waybill (HAWB) hoặc Master B/L / House B/L; kiểm tra mã EORI người gửi/người nhận.
- **Định dạng:** JSON chuẩn Annex B + XLSX.
- **Duyệt:** `customs_specialist`.

#### R07 — EVFTA Origin Support Workbook (Bảng tính hỗ trợ xuất xứ EVFTA)
- **Bản chất:** Hồ sơ kỹ thuật giải trình tiêu chí xuất xứ hàng hóa (BOM phân rã, tỷ lệ nguyên liệu không có xuất xứ, tiêu chí CTC chuyển đổi mã số hàng hóa hoặc tỷ lệ giá trị gia tăng RVC) phục vụ xin cấp C/O Form EUR.1 hoặc tự chứng nhận xuất xứ.
- **Kiểm soát:** Gắn chặt bằng chứng nguồn gốc xuất xứ của từng nhà cung ứng sợi/vải (`evidenceDocumentId` đã khóa); cảnh báo rõ ràng văn bản này là bảng giải trình nội bộ, không thay thế Giấy chứng nhận xuất xứ chính thức do Bộ Công Thương cấp.
- **Định dạng:** JSON + XLSX.
- **Duyệt:** `customs_specialist`.

---

### NHÓM 3: NHÃN MÁC, AN TOÀN SẢN PHẨM & HÓA CHẤT EU (R08 – R11)

#### R08 — EU Textile Fibre Label (Nhãn thành phần sợi dệt may)
- **Căn cứ pháp lý:** Quy định EU số 1007/2011 về tên gọi và dán nhãn thành phần sợi dệt may.
- **Kiểm soát nghiệp vụ:**
  - Tổng tỷ lệ phần trăm các loại sợi phải bằng chính xác **$100\%$**.
  - Tên gọi loại sợi bắt buộc phải thuộc danh mục Phụ lục I của Regulation 1007/2011 (bằng tiếng Anh và ngôn ngữ nước nhập khẩu).
  - Tự động kích hoạt cờ cảnh báo *"Chứa các bộ phận không dệt có nguồn gốc từ động vật"* (Contains non-textile parts of animal origin) nếu có da, lông vũ hoặc nút vỏ ốc.
- **Test:** Pass 16/16 backend tests (`textileFibreLabelControls.test.js`) và 2/2 frontend tests.

#### R09 — EU Footwear Material Label (Nhãn thành phần vật liệu giày dép)
- **Căn cứ pháp lý:** Chỉ thị 94/11/EC của Nghị viện châu Âu về dán nhãn vật liệu giày dép.
- **Quy tắc bắt buộc:** Khai báo 3 bộ phận chính:
  1. Mặt trên (Upper).
  2. Lớp lót và đế trong (Lining and Insole).
  3. Đế ngoài (Outsole).
- **Quy tắc 80%:** Nếu một loại vật liệu (Da thuộc, Da có tráng phủ, Hàng dệt, hoặc Vật liệu khác) chiếm ít nhất $80\%$ diện tích bề mặt/thể tích của bộ phận thì phải công bố đích danh; nếu không có loại nào đạt $80\%$ thì phải ghi rõ là hỗn hợp vật liệu.
- **Hiện trạng:** Đang ở trạng thái `NOT_STARTED`; cấu trúc dữ liệu đã được quy hoạch trong `types.ts`.

#### R10 — GPSR Technical File (Hồ sơ an toàn sản phẩm chung EU)
- **Căn cứ pháp lý:** Quy định an toàn sản phẩm chung EU 2023/988 (GPSR - có hiệu lực bắt buộc từ 13/12/2024).
- **Nội dung hồ sơ:**
  - Định danh thực thể chịu trách nhiệm tại EU (EU Responsible Person / Authorized Representative) gồm tên, địa chỉ thực tế và email.
  - Mã lô sản xuất và truy xuất nguồn gốc (Batch/Serial Number).
  - Báo cáo đánh giá rủi ro an toàn sản phẩm (Risk Assessment) và kết quả thử nghiệm trong phòng lab đạt chuẩn (Test Reports).
  - Hướng dẫn cảnh báo an toàn bằng ngôn ngữ của quốc gia thành viên EU nơi sản phẩm được bán.
- **Test:** Pass 16/16 backend tests và 2/2 frontend tests.

#### R11 — REACH SVHC Dossier (Hồ sơ kiểm soát hóa chất độc hại)
- **Căn cứ pháp lý:** Quy định REACH 1907/2006 (Điều 33 & Nghĩa vụ thông báo SCIP).
- **Kiểm soát nồng độ:** Mọi chất thuộc Danh mục hóa chất có nguy cơ rất cao (Candidate List of SVHCs) có nồng độ vượt quá **$0.1\%$ theo trọng lượng ($w/w$)** đều bắt buộc phải kích hoạt quy trình:
  - Cung cấp tài liệu hướng dẫn sử dụng an toàn cho khách hàng/người tiêu dùng.
  - Khởi tạo mã định danh nộp vào Cơ sở dữ liệu SCIP của Cơ quan Hóa chất Châu Âu (ECHA).
- **Test:** Pass 16/16 backend tests và 2/2 frontend tests.

---

### NHÓM 4: DẤU CHÂN CARBON & BẰNG CHỨNG KIỂM TOÁN (R12 – R14)

#### R12 — Product Carbon Footprint Dossier (Hồ sơ PCF theo ISO 14067)
- **Chuẩn mực:** ISO 14067:2018 và GHG Protocol Product Standard.
- **Kiểm soát:** Ranh giới từ cái nôi đến cổng (Cradle-to-Gate), phân rã phát thải theo 4 giai đoạn vòng đời, gắn hệ số phát thải từ cơ sở dữ liệu có thẩm quyền kèm cấp độ chất lượng dữ liệu (DQL L1-L5).
- **Lưu ý:** Báo cáo nội bộ phục vụ đối soát (`INTERNAL_ONLY`); không được dùng để công bố quảng bá ra công chúng nếu chưa có kiểm tra phê bình độc lập (Critical Review).

#### R13 — Corporate GHG Inventory Report (Báo cáo phát thải doanh nghiệp)
- **Chuẩn mực:** GHG Protocol Corporate Standard và ISO 14064-1:2018.
- **Kiểm soát:** Báo cáo 7 loại khí nhà kính ($CO_2, CH_4, N_2O, HFCs, PFCs, SF_6, NF_3$), tách biệt rõ phương pháp Location-based và Market-based đối với Scope 2; hạch toán độc lập các khoản bù trừ tín chỉ carbon (không được khấu trừ gộp vào phát thải thô).

#### R14 — Audit Pack Bundle & Assurance Statement (Gói hồ sơ kiểm toán đóng gói)
- **Bản chất:** Tệp nén `.zip` bất biến chứa toàn bộ bằng chứng số học, hợp đồng, hóa đơn tiền điện, nhật ký viễn trắc WeaveNode và chứng nhận lab liên quan đến lô hàng/kỳ báo cáo.
- **Cơ chế an toàn:** Gói bundle được niêm phong bằng hàm băm SHA-256; cung cấp liên kết chia sẻ tạm thời có chữ ký điện tử (Signed Share Link hết hạn sau 7 ngày) cho kiểm toán viên độc lập; lưu vết xác thực chứng thư cam đoan kiểm định (Assurance Statement).
- **Test:** Pass 30/30 backend tests và 8/8 frontend tests.

---

### NHÓM 5: BÁO CÁO MÔI TRƯỜNG CHUYÊN SÂU & THỊ TRƯỜNG MỚI (R15 – R20)

#### R15 — Apparel & Footwear PEF/PEFCR
- Đánh giá toàn diện 16 tác động môi trường (suy thoái đất, tiêu thụ nước, phú dưỡng, tiềm năng ấm lên toàn cầu, v.v.) theo quy tắc ngành PEFCR. Hiện trạng: Đang ở giai đoạn lộ trình nghiên cứu (`NOT_STARTED`).

#### R16 — ESPR Digital Product Passport (Hộ chiếu sản phẩm số)
- Khung sinh thái Ecodesign for Sustainable Products Regulation (ESPR - EU 2024/1781). Hiện trạng: Đã xây dựng nguyên mẫu bảo vệ (Guarded Prototype) với mã QR truy xuất và khóa bất biến DPP V2, đang chờ Ủy ban Châu Âu ban hành văn bản hướng dẫn chi tiết về cấu trúc dữ liệu cho ngành dệt may (dự kiến áp dụng 2026–2027).

#### R17 — EU Textile/Footwear EPR Core (Trách nhiệm mở rộng nhà sản xuất dệt may)
- Quản lý nghĩa vụ đăng ký tổ chức thu hồi (PRO) và nộp phí xử lý rác thải dệt may tại từng quốc gia thành viên EU (Pháp, Hà Lan, Đức). Đã có module kiểm soát `euTextileEprControls.js` pass 39/39 tests.

#### R18 — Environmental Claim Register (Chống tẩy xanh theo Green Claims Directive)
- Sổ đăng ký kiểm soát các công bố xanh trên bao bì, tem nhãn và website marketing. Ngăn chặn tuyệt đối các phát ngôn chung chung như *"100% Eco-friendly"*, *"Carbon Neutral"* nếu không gắn kèm mã định danh bằng chứng kiểm định độc lập cấp 3. Pass 39/39 tests.

#### R19 — EU CBAM Declaration (Báo cáo điều chỉnh biên giới carbon)
- Mặc dù ngành may mặc và giày dép hiện tại **không thuộc phụ lục I áp dụng CBAM** (`NOT_APPLICABLE_BASELINE`), hệ thống đã chuẩn bị sẵn bộ mẫu 6 sheet XLSX chuẩn mực để kích hoạt ngay khi hàng hóa có mã HS thuộc ngành thép, nhôm hoặc khi EU mở rộng phạm vi sang dệt may.

#### R20 — Specialist Permits & Triage (Sàng lọc giấy phép chuyên ngành)
- Bộ máy tự động quét mã HS/TARIC, nước xuất xứ và tính chất vật liệu để sàng lọc các yêu cầu đặc thù: Giấy phép CITES (da động vật hoang dã), kiểm dịch thực vật, kiểm tra hạn chế chất độc hại theo Phụ lục XVII REACH. Pass 39/39 tests.

---

## KẾ HOẠCH HÀNH ĐỘNG TIẾP THEO

1. **Về R01 & R02:** Giữ nguyên code hiện tại, không can thiệp sửa đổi. Chuẩn bị hồ sơ dữ liệu lô hàng thực tế (Pilot Fixture) để đưa lên môi trường Staging.
2. **Về các hạng mục P0:** Sẵn sàng triển khai tuần tự theo 3 gói của `IMPLEMENTATION_BACKLOG.md`:
   - Gói A: Lưu snapshot lịch sử tính toán carbon backend, giữ số 0 thực tế.
   - Gói B: Nâng cấp Evidence Vault (tải file gốc, phân quyền xóa, Evidence Selector).
   - Gói C: Phê duyệt Factor Proposal, vòng đời sáng kiến giảm phát thải, hồ sơ nộp MRV Việt Nam.
3. **Về Pilot Thật:** Chạy đối chiếu R01 và R02 với chứng từ thực tế của doanh nghiệp trên Staging để chính thức chuyển trạng thái sang `READY_TO_ISSUE`.
