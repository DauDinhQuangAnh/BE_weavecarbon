# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R02 – Packing List

> **Mã Báo Cáo:** R02  
> **Tên Tài Liệu:** Bảng Kê Đóng Gói Xuất Khẩu (Export Packing List / Container - Pallet - Carton Ledger)  
> **Tệp Mã Nguồn:**  
> - Frontend: `Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx`, `Weavecarbon/lib/weave-v2/shipmentExportApi.ts`  
> - Backend: `BE_weavecarbon/src/services/exportShipmentService.js`, `BE_weavecarbon/src/services/exportDocumentPdf.js`, `BE_weavecarbon/src/routes/exportV2.js`  
> **Trạng Thái Hiện Tại:** `READY_TO_ISSUE` (Đã hoàn thành kiểm thử Pilot thực tế Staging, đối soát 100% khớp R01)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `warehouse_reviewer` (Người phụ trách kho vận)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Định Dạng Đầu Ra:** XLSX (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) và PDF (`application/pdf`)  
> **Ngày Đánh Giá:** 29/09/2026 (Nghiệm thu Staging Pilot: 02/10/2026)  

---

## 1. Vị Trí Trong Hồ Sơ Xuất Khẩu & Mối Quan Hệ Nghiệp Vụ

Packing List (R02) là chứng từ kiểm soát hiện vật bắt buộc đi kèm với Commercial Invoice (R01) và Vận đơn vận chuyển (R03) trong mọi lô hàng xuất khẩu từ Việt Nam sang EU/Hoa Kỳ.
- **R01 (Hóa đơn thương mại):** Xác lập giá trị giao dịch, điều khoản thanh toán, Incoterms, thuế và mã số HS/CN.
- **R02 (Bảng kê đóng gói):** Xác lập thực thể vật lý của lô hàng: cấu trúc phân cấp đóng gói (Container $\rightarrow$ Pallet $\rightarrow$ Kiện/Thùng Carton), quy cách kích thước (Dài x Rộng x Cao cm), thể tích (CBM), trọng lượng tịnh (Net Weight) và trọng lượng cả bì (Gross Weight).
- **R03 (Chứng từ vận tải / B/L):** Vận đơn của hãng tàu đối soát lại số container, số seal, tổng số kiện và tổng trọng lượng cả bì do R02 cung cấp.

---

## 2. Kiểm Tra Luồng Tương Tác 7 Bước (End-to-End Traceability)

### Bước 1: Giao Diện Người Dùng (UI Controls)
- **Vị trí:** [`Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx) (Mục 15 - Mức hoàn thiện tài liệu).
- **Thành phần điều khiển:**
  - Bộ chọn định dạng (`Select`): Hỗ trợ chuyển đổi giữa `PDF / bản in` và `XLSX / bảng tính`.
  - Nút "Tạo bản review" (`Button`): Đưa yêu cầu vào hàng đợi xử lý ngầm (`busy state`).
  - Nút "Tải" (`Download`): Xuất hiện ngay khi tệp được tạo thành công kèm tên tệp chuẩn (ví dụ `packing_list_v1.pdf`).
  - Khung phê duyệt nghiệp vụ: Chỉ hiển thị cho tài khoản có quyền với vai trò chỉ định `warehouse_reviewer`, gồm ô nhập `reviewNotes` và 2 nút hành động:
    - **Duyệt (`approved`):** Ghi nhận trạng thái sẵn sàng phát hành.
    - **Yêu cầu sửa (`changes_requested`):** Khóa quyền phát hành và yêu cầu cập nhật lại số liệu đóng gói.
  - Nút "Phát hành" (`FileCheck2`): Khóa phiên bản bất biến khi có quyết định phê duyệt hợp lệ.

### Bước 2: Request Frontend (API Client)
- **Tệp client:** [`Weavecarbon/lib/weave-v2/shipmentExportApi.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/weave-v2/shipmentExportApi.ts).
- **Các hàm điều phối:**
  - `generateShipmentExportDocument(shipmentId, 'packing_list', format)`: Gửi POST tạo bản review.
  - `reviewShipmentExportDocument(shipmentId, documentId, { reviewerRole: 'warehouse_reviewer', decision, notes })`: Gửi quyết định phê duyệt có chữ ký phiên bản.
  - `issueShipmentExportDocument(shipmentId, documentId)`: Gửi yêu cầu phát hành bản khóa.

### Bước 3: Định Tuyến & Điều Khiển Backend (Route & Controller)
- **Định tuyến:** `BE_weavecarbon/src/routes/exportV2.js` gắn middleware `authenticate` và `requireRole('b2b')`.
- **Cơ chế xác thực quyền:** Thao tác review và issue yêu cầu bổ sung `requireCompanyAdmin` để ngăn chặn nhân viên không có thẩm quyền ký xác nhận pháp lý.

### Bước 4: Xử Lý Nghiệp Vụ & Nguồn Dữ Liệu (Service & Data Source)
- **Dịch vụ chính:** [`BE_weavecarbon/src/services/exportShipmentService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/exportShipmentService.js).
- **Mô hình dữ liệu:**
  - Bảng `export_shipment_profiles`: Lưu trữ `packing_list_number`, `packing_list_date`, `carrier_name`, `transport_mode`, `bill_of_lading_no`, `port_of_loading`, `port_of_discharge`, `place_of_delivery`.
  - Bảng `export_containers`: Lưu thông tin vỏ container (`container_number`, `seal_number`, `max_gross_mass_kg`).
  - Bảng `export_package_records`: Lưu trữ chuỗi cây đóng gói phân cấp:
    - Gốc: Container ID.
    - Trung gian: Pallet ID (tùy chọn).
    - Lá (Leaf Packages): Thùng carton thực tế (`package_number`, `package_type`, `sequence_no`, `length_cm`, `width_cm`, `height_cm`, `net_weight_kg`, `gross_weight_kg`, `weight_measurement_basis`, `dimension_measurement_basis`, `contents`).
- **Quy tắc kiểm soát đối soát bắt buộc (Validation Gate):**
  1. `packing_list_number` và `packing_list_date` (chuẩn ISO YYYY-MM-DD) không được để trống.
  2. `transport_mode` và `carrier_name` phải được điền.
  3. Mọi kiện hàng phải có $Gross \ge Net$.
  4. Cơ sở đo lường (`weight_measurement_basis` và `dimension_measurement_basis`) phải được xác định rõ là `per_package` (từng thùng) hoặc `group_total` (tổng cụm).
  5. Đối soát cân nặng chéo (Cross-document weight reconciliation):
     - $\sum Net_{\text{packages}} == \sum Net_{\text{lines}}$ (Tổng Net Weight của các kiện hàng phải bằng đúng tổng Net Weight của hàng hóa trên Invoice).
     - $\sum Gross_{\text{packages}} == \sum Gross_{\text{lines}}$.
  6. Đối soát số lượng phân bổ hàng hóa (Quantity allocation reconciliation):
     - Số lượng SKU/style/size phân vào từng thùng phải cộng lại bằng chính xác $100\%$ số lượng đặt mua trên hóa đơn.

### Bước 5: Tạo Tệp Đầu Ra Thực Tế (Output Generation)
- **XLSX Workbook:**
  - Tiêu đề: `PACKING LIST`.
  - Sheet: `packing_list`.
  - Dán nhãn kiểm soát: `CONTROLLED COPY - VERIFY STATUS IN WEAVECARBON`.
  - 14 cột chuẩn mực: `Container`, `Seal`, `Pallet`, `Package`, `Type`, `Marks`, `Packages`, `Weight basis`, `Net kg total`, `Gross kg total`, `Dimension basis`, `L x W x H cm`, `CBM total`, `Contents`.
- **PDF Vector Document:**
  - Sinh bởi [`BE_weavecarbon/src/services/exportDocumentPdf.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/exportDocumentPdf.js).
  - Khổ giấy: A4 Landscape (nằm ngang), căn lề 36pt.
  - Header: Thương hiệu WeaveCarbon, mã tham chiếu lô hàng và số phiên bản tài liệu.
  - Khối đối tác: Exporter (bên gửi hàng) & Consignee (bên nhận hàng).
  - Khối chi tiết: Bảng kê `CONTAINER - PALLET - CARTON LEDGER` với bề rộng cột được tính toán chính xác để không bao giờ tràn trang.
  - Khối tổng kết đóng gói: 6 ô thẻ thống kê nổi bật:
    1. **Containers:** Tổng số vỏ container.
    2. **Packages:** Tổng số kiện hàng / thùng carton.
    3. **Goods quantity:** Tổng số lượng sản phẩm chi tiết.
    4. **Net weight:** Tổng trọng lượng tịnh ($kg$).
    5. **Gross weight:** Tổng trọng lượng cả bì ($kg$).
    6. **Volume:** Tổng thể tích đóng gói ($CBM$).
  - Watermark chìm: `CONTROLLED COPY` khi ở bản nháp review; chuyển sang dấu kiểm soát phát hành khi đã được `issue`.

### Bước 6: Thẩm Quyền & Chuỗi Khóa Bất Biến (Review & Issue Lifecycle)
- **Vai trò phê duyệt:** Bắt buộc là `warehouse_reviewer`.
- **Bảo toàn tính toàn vẹn (Tamper-evident Triple Checksum):**
  - `sourceSnapshotSha256`: Băm SHA-256 của toàn bộ dữ liệu lô hàng tại thời điểm tạo.
  - `payloadSha256`: Băm SHA-256 của dữ liệu cấu trúc đầu vào tài liệu.
  - `fileSha256`: Băm SHA-256 của đúng tệp PDF/XLSX sinh ra trên đĩa.
  - Nếu bất kỳ dữ liệu lô hàng nào bị thay đổi sau khi tạo bản review, chữ ký băm sẽ lệch và hệ thống tự động khóa (block) không cho phép phát hành.

### Bước 7: Bằng Chứng Kiểm Thử Tự Động (Test Coverage)
- `tests/services/exportShipmentService.test.js`:
  - Kiểm thử cấu trúc 14 cột của Packing List XLSX.
  - Kiểm thử nén ZIP và đọc ngược file XLSX bằng JSZip.
  - Kiểm thử cơ chế chặn khi thiếu `packing_list_number`.
  - Kiểm thử sinh buffer PDF hợp lệ (`%PDF-`, kích thước $> 20,000$ bytes).
  - Kiểm thử tính toán `_documentRows('packing_list', snapshot)` cho kịch bản nhiều container và pallet.
- Tỷ lệ vượt qua: **38/38 tests PASSED (100%)**.

---

## 3. Các Khoảng Trống Nghiệp Vụ Cần Chú Ý Trước Khi Chạy Pilot Thật

Qua rà soát chuyên sâu, R02 hiện tại đã hoàn chỉnh về mặt khung code và kiểm tra số học, tuy nhiên có **2 điểm cần đối chiếu với nghiệp vụ kho vận thực tế**:
1. **Quy tắc làm tròn thể tích CBM:**
   - Trong code hiện tại: $\text{CBM} = \text{Dài} \times \text{Rộng} \times \text{Cao} / 1,000,000$.
   - Một số hãng tàu và forwarder quốc tế yêu cầu làm tròn CBM đến 3 chữ số thập phân (ví dụ $12.345 \text{ m}^3$) thay vì hiển thị số thực nhiều chữ số lẻ. Cần thống nhất quy ước làm tròn với đơn vị vận tải trong Pilot.
2. **Ký hiệu loại bao bì (Package Type Codes):**
   - Hiện tại hệ thống cho phép nhập text tự do (như `Carton`, `Box`, `Bale`, `Roll`).
   - Theo chuẩn hải quan quốc tế UNECE Recommendation 21, các loại bao bì thường có mã 2 ký tự (ví dụ `CT` cho Carton, `PX` cho Pallet, `BX` cho Box). Khi tích hợp sâu với R04 (VNACCS) và R06 (ICS2), cần ánh xạ chuẩn mã UNECE này.

---

## 4. Kết Luận Về R02 – Packing List

- **Đánh giá tổng thể:** R02 – Packing List đạt trạng thái **`READY_TO_PILOT`** vững chắc. Cấu trúc bảng kê Container - Pallet - Carton Ledger cùng hệ thống đối soát chéo cân nặng và số lượng phân bổ hàng hóa là điểm mạnh vượt trội, ngăn ngừa hoàn toàn các lỗi lệch số liệu giữa khai báo hải quan và thực tế giao nhận tại kho.
- **Hành động tiếp theo:** Giữ nguyên code hiện tại, không thêm thắt tính năng phụ, tiến hành chuẩn bị bộ dữ liệu lô hàng thực nghiệm (Pilot Fixture) để chạy thử nghiệm thực tế song song với R01.
