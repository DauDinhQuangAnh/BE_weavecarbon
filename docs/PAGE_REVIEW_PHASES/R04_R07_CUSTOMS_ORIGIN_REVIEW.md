# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R04 – R07 (Thông Quan & Xuất Xứ Hàng Hóa)

> **Nhóm Báo Cáo:** Nhóm 2 — Bàn Giao Thông Quan & Xuất Xứ Hàng Hóa (Customs Clearance & Rules of Origin)  
> **Các Mã Báo Cáo:**  
> - **R04:** Bàn giao đại lý hải quan Việt Nam (Vietnam Customs Broker Handoff / VNACCS Integration Pack)  
> - **R05:** Bàn giao người khai hải quan nhập khẩu EU (EU Import Declarant Handoff / EUCDM Standard)  
> - **R06:** Hồ sơ hỗ trợ khai báo an ninh nhập cảnh EU (ICS2 Filing Handoff / ENS Dataset)  
> - **R07:** Bảng tính giải trình quy tắc xuất xứ EVFTA (EVFTA Origin Support Workbook / C/O Form EUR.1)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `customs_specialist` (Chuyên viên thủ tục hải quan)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Ngày Đánh Giá:** 29/09/2026  

---

## 1. Tổng Quan Kiến Trúc & Ranh Giới Trách Nhiệm Pháp Lý

Nhóm báo cáo R04 – R07 giải quyết mắt xích phức tạp nhất trong chuỗi cung ứng quốc tế: **Tuân thủ quy định hải quan hai đầu xuất - nhập và hưởng ưu đãi thuế quan theo hiệp định thương mại tự do (EVFTA)**.

> [!IMPORTANT]
> **Tuyên bố ranh giới pháp lý bắt buộc (Non-Submission Boundary):**  
> WeaveCarbon **không phải là cổng kết nối trực tiếp (Direct EDI Gateway) nộp tờ khai vào hải quan nhà nước**, mà là **Nền tảng chuẩn bị dữ liệu kỹ thuật số có kiểm soát (Controlled Digital Handoff Package)**.  
> - Tại Việt Nam: Dữ liệu R04 được xuất ra dưới dạng JSON/XLSX chuẩn hóa để đại lý hải quan (Customs Broker) nạp vào phần mềm khai báo hải quan điện tử VNACCS/VCIS.  
> - Tại EU: Dữ liệu R05 & R06 được đối soát theo mô hình dữ liệu hải quan EU (EUCDM Release 6.2 và ICS2 Release 3) để người nhập khẩu/hãng vận chuyển nộp tờ khai H1/ENS.  
> - Về Xuất xứ: R07 là bảng tính kỹ thuật phân rã chi phí và quy tắc xuất xứ nội bộ, làm căn cứ nộp hồ sơ xin cấp C/O Form EUR.1 tại VCCI/Phòng Quản lý XNK - Bộ Công Thương hoặc phục vụ tự chứng nhận xuất xứ (REX/Origin Declaration).

---

## 2. Chi Tiết Rà Soát Từng Báo Cáo

### R04 — Bàn Giao Đại Lý Hải Quan Việt Nam (VNACCS Handoff)

#### 1. Điều khiển & Luồng dữ liệu
- **Mã nguồn:** `BE_weavecarbon/src/services/vnCustomsHandoffControls.js`.
- **Nút UI:** Trên `ShipmentExportPortal.tsx`, thẻ `customs_vn_broker_handoff`.
- **Mã schema:** `weavecarbon.vn-export-broker-handoff@1.0.0`.
- **Định dạng xuất:** JSON cấu trúc + Bảng tính XLSX đối soát.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Mã HS 8 chữ số chuẩn Việt Nam:** Bắt buộc 100% dòng hàng phải có mã HS 8 số (`^\d{8}$`), phân biệt với mã 6 số quốc tế.
2. **Mã Chi cục Hải quan mở tờ khai:** Kiểm tra mã 4 ký tự của Chi cục Hải quan quản lý (ví dụ: `02CI` - Chi cục HQ CK Cảng Sài Gòn KV 1).
3. **Mã loại hình xuất khẩu:** Kiểm tra mã chuẩn hải quan VN (ví dụ: `B11` - Xuất kinh doanh, `E62` - Xuất sản phẩm gia công, `E42` - Xuất sản phẩm sản xuất xuất khẩu).
4. **Tỷ giá và quy đổi đồng tiền:** Tự động đối soát tỷ giá hạch toán hải quan công bố của Ngân hàng Nhà nước.
5. **Chứng từ đính kèm (V5/V6):** Tự động liên kết danh mục chứng từ điện tử đính kèm (Hóa đơn thương mại, Packing List, Giấy phép).

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/vnCustomsHandoffControls.test.js`: **Pass 100%** (kiểm tra mã HS 8 số, tính toàn vẹn JSON và đối soát trọng lượng/giá trị).

---

### R05 — Bàn Giao Người Khai Hải Quan EU (EUCDM Handoff)

#### 1. Điều khiển & Luồng dữ liệu
- **Mã nguồn:** `BE_weavecarbon/src/services/euImportHandoffControls.js`.
- **Nút UI:** Thẻ `customs_eu_import_declarant_handoff`.
- **Mã schema:** `weavecarbon.eu-import-declarant-handoff@1.0.0` (tham chiếu EUCDM H1 Declaration).
- **Định dạng xuất:** JSON cấu trúc EUCDM + XLSX.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Khớp mã TARIC 10 chữ số đã xác nhận:** Bắt buộc mã TARIC 10 số (`taricConfirmed = true`). Mã TARIC phải đồng nhất với 6 chữ số đầu của mã HS xuất khẩu (HS6 continuity check).
2. **Kiểm tra mã EORI người nhập khẩu:** Người nhập khẩu (Importer) và người khai hải quan (Declarant) tại EU bắt buộc phải có mã EORI hợp lệ (`^[A-Z]{2}[A-Z0-9]{1,15}$`).
3. **Mã ưu đãi thuế quan (Preference Code):** Kiểm tra mã ưu đãi (ví dụ: `300` - Ưu đãi thuế quan theo Hiệp định thương mại tự do EVFTA).
4. **Hạn chế số dòng hàng:** Không áp đặt giới hạn ngầm số dòng hàng; kiểm tra toàn bộ 25+ dòng hàng mà không bị tràn bộ nhớ hoặc rớt dữ liệu.
5. **Fail-closed:** Nếu phát hiện quốc gia đích không thuộc 27 nước thành viên EU hoặc thiếu hồ sơ bảo lãnh thuế (`guaranteeReference`), hệ thống tự động khóa chặn phát hành.

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/euImportHandoffControls.test.js`: **Pass 5/5 tests (100%)**:
  - `validates every one of 25 TARIC-mapped lines without an implicit line cap`
  - `fails closed without a national target schema or separately confirmed TARIC classification`
  - `rejects non-EU destinations and TARIC codes that break HS6 continuity`
  - `requires exact references for claimed preference, restrictions and guarantees`
  - `builds an explicitly non-submittable EUCDM-referenced controlled dataset`

---

### R06 — Hồ Sơ Hỗ Trợ Khai Báo An Ninh Nhập Cảnh EU (ICS2 Filing Handoff)

#### 1. Điều khiển & Luồng dữ liệu
- **Mã nguồn:** `BE_weavecarbon/src/services/ics2HandoffControls.js`.
- **Nút UI:** Thẻ `ics2_filing_handoff`.
- **Mã schema:** `weavecarbon.eu-ics2-filing-handoff@1.0.0` (tham chiếu ENS Annex B Regulation 2015/2446).
- **Định dạng xuất:** JSON cấu trúc + Bảng kê XLSX.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Phân cấp chứng từ vận tải:** Phân biệt rành mạch giữa Master Air Waybill (MAWB) / Master B/L và House Air Waybill (HAWB) / House B/L.
2. **Mã định danh EORI bên liên quan:** Kiểm tra mã EORI của Carrier (Hãng vận chuyển) và Postal Operator/Freight Forwarder.
3. **Độ phân giải mã HS cấp 6 số:** Bắt buộc mô tả hàng hóa thương mại chi tiết kèm mã HS tối thiểu 6 số cho từng kiện hàng (ngăn ngừa mô tả chung chung như *"garments"*, *"shoes"*).
4. **Địa chỉ thực thể chi tiết:** Kiểm tra tên, số nhà, tên đường, mã bưu chính (Postal Code), thành phố và mã quốc gia ISO 2 ký tự của người gửi và người nhận (bắt buộc theo chuẩn ICS2 Release 3).

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/ics2HandoffControls.test.js`: **Pass 100%** (kiểm tra phân tách Master/House transport, băm SHA-256 dữ liệu và đối soát kiện hàng).

---

### R07 — Bảng Tính Hỗ Trợ Xuất Xứ EVFTA (Origin Workbook)

#### 1. Điều khiển & Luồng dữ liệu
- **Mã nguồn:** `BE_weavecarbon/src/services/originHandoffControls.js`.
- **Nút UI:** Thẻ `evfta_origin_workbook`.
- **Mã schema:** `weavecarbon.evfta-origin-support-workbook@1.0.0`.
- **Định dạng xuất:** Bảng tính XLSX đa sheet + JSON cấu trúc.

#### 2. Rào chắn kiểm soát nghiệp vụ (Validation Gates)
1. **Phân rã bảng định mức nguyên phụ liệu (BOM Breakdown):** Từng nguyên phụ liệu (sợi, vải, chỉ may, khuy, cúc, đế giày) được phân loại:
   - Nguyên liệu có xuất xứ EVFTA (`originating`).
   - Nguyên liệu không có xuất xứ (`non_originating`).
2. **Kiểm tra Quy tắc cụ thể mặt hàng (PSR - Product Specific Rules):**
   - **Ngành dệt may (Chương 61, 62):** Kiểm tra quy tắc *"Từ vải trở đi"* (Fabric-forward / Double transformation: Dệt vải $\rightarrow$ Cắt may tại Việt Nam). Hỗ trợ cơ chế cộng gộp mở rộng (Extended cumulation: sử dụng vải từ Hàn Quốc/Nhật Bản có hiệp định song phương).
   - **Ngành giày dép (Chương 64):** Kiểm tra tiêu chí chuyển đổi mã số hàng hóa (CTC) và tỷ lệ giá trị nguyên liệu không có xuất xứ không vượt quá ngưỡng cho phép (MaxNOM $45\% - 50\%$).
3. **Liên kết chứng từ nguồn gốc:** Bắt buộc từng dòng nguyên liệu phải gắn với `evidenceDocumentId` (Tờ khai nhập khẩu, Hóa đơn GTGT, Chứng nhận xuất xứ của nhà cung cấp nội địa) đã được khóa trong Vault.
4. **Tuyên bố miễn trừ trách nhiệm:** Bảng tính đóng dấu nổi bật: *"Bảng giải trình kỹ thuật nội bộ hỗ trợ doanh nghiệp lập hồ sơ xin cấp C/O Form EUR.1. Tài liệu không thay thế Giấy chứng nhận xuất xứ chính thức do cơ quan có thẩm quyền cấp."*

#### 3. Bằng chứng kiểm thử tự động
- `tests/services/originHandoffControls.test.js`: **Pass 100%** (kiểm tra tính toán MaxNOM, quy tắc chuyển đổi mã số và ràng buộc chứng từ nhà cung ứng).

---

## 3. Bảng Tổng Hợp Kiểm Thử & Trạng Thái Nhóm 2

| Mã | Tên Báo Cáo | Căn Cứ Pháp Lý | Trạng Thái Kỹ Thuật | Backend Tests | Quyền Phê Duyệt |
|:---:|---|---|:---:|:---:|:---:|
| **R04** | VN Customs Handoff | Thông tư 38/2015/TT-BTC, 39/2018/TT-BTC | `PARTIAL` (Sẵn sàng cho Pilot) | Pass 100% | `customs_specialist` |
| **R05** | EU Import Declarant | UCC (EU) 952/2013, EUCDM Release 6.2 | `READY_TO_PILOT` | 5/5 tests pass | `customs_specialist` |
| **R06** | ICS2 Filing Handoff | EU 2015/2446 Annex B, ICS2 Release 3 | `PARTIAL` (Sẵn sàng cho Pilot) | Pass 100% | `customs_specialist` |
| **R07** | EVFTA Origin Support | Hiệp định EVFTA Nghị định thư 1, TT 11/2020/TT-BCT | `PARTIAL` (Sẵn sàng cho Pilot) | Pass 100% | `customs_specialist` |

---

## 4. Kết Luận
Cả 4 báo cáo R04 – R07 đều đã hoàn tất cấu trúc logic kiểm soát, cơ chế bảo vệ fail-closed và phân định ranh giới pháp lý minh bạch. Người dùng thuộc vai trò `customs_specialist` có thể tự tin sử dụng các gói bàn giao này để làm việc với đại lý hải quan và cơ quan cấp C/O trong đợt Pilot.
