# Báo Cáo Rà Soát Kỹ Thuật & Nghiệp Vụ Chuyên Sâu: R03 – Carrier Transport Document & Carbon Annex

> **Mã Báo Cáo:** R03  
> **Tên Tài Liệu:** Chứng Từ Vận Tải Hãng Tàu & Phụ Lục Phát Thải Carbon (Carrier Transport Document & Verified Carbon Annex)  
> **Tệp Mã Nguồn:**  
> - Backend: `BE_weavecarbon/src/services/carrierDocumentControls.js`, `BE_weavecarbon/migrations/024_r03_carrier_document_controls.sql`, `BE_weavecarbon/src/services/exportShipmentService.js`  
> - Frontend: `Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx`, `Weavecarbon/lib/weave-v2/shipmentExportApi.ts`  
> **Trạng Thái Hiện Tại:** `EXTERNAL_DOCUMENT` (Chứng từ vận tải ngoại vi được xác minh) + `READY_TO_PILOT` (Phụ lục Carbon Annex)  
> **Người Duyệt Nghiệp Vụ Chỉ Định:** `export_operator` (Chuyên viên vận hành xuất khẩu)  
> **Thẩm Quyền Phát Hành:** `company_admin` (Quản trị viên công ty)  
> **Định Dạng Đầu Ra:** Carrier File gốc (PDF/TIFF) kèm XLSX Phụ lục Carbon Annex độc lập  
> **Ngày Đánh Giá:** 29/09/2026  

---

## 1. Vị Trí Trong Hồ Sơ Xuất Khẩu & Mối Quan Hệ Nghiệp Vụ

Trong bộ ba chứng từ xuất khẩu bắt buộc (Commercial Invoice - Packing List - Bill of Lading):
- **Commercial Invoice (R01):** Khẳng định quyền sở hữu thương mại và giá trị hải quan.
- **Packing List (R02):** Khẳng định hiện vật đóng gói và trọng lượng từ nhà máy.
- **Carrier Transport Document & Carbon Annex (R03):** 
  - Khẳng định hàng hóa đã được hãng vận chuyển tiếp nhận thực tế lên phương tiện vận tải (Hải vận: Bill of Lading / Sea Waybill; Hàng không: Air Waybill; Đường bộ: CMR; Đường sắt: CIM; Đa phương thức: FIATA FBL).
  - Cung cấp **Phụ lục Carbon Annex** xác thực phát thải GHG trong toàn bộ chặng vận tải (Well-to-Wheel / Tank-to-Wheel) phục vụ báo cáo Scope 3 và đối soát chuỗi cung ứng xanh của nhà mua hàng EU/Hoa Kỳ.

> [!IMPORTANT]
> **Nguyên tắc pháp lý then chốt:**  
> WeaveCarbon **tuyệt đối không tự ý phát hành vận đơn giả lập**. Vận đơn là chứng từ pháp lý do hãng vận chuyển có tư cách pháp nhân cấp. Hệ thống chỉ:
> 1. Tiếp nhận, kiểm tra tính hợp lệ và niêm phong tệp gốc từ hãng tàu vào Evidence Vault.
> 2. Đối soát chéo số container, số seal, tổng kiện và trọng lượng với Packing List.
> 3. Tự động tính toán phát thải logistics và cấp kèm **Phụ lục phát thải Carbon Annex** có mã băm bảo chứng.

---

## 2. Kiểm Tra Luồng Tương Tác 7 Bước (End-to-End Traceability)

### Bước 1: Giao Diện Người Dùng (UI Controls)
- **Vị trí:** [`Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/export/ShipmentExportPortal.tsx) (Thẻ chứng từ vận tải).
- **Thành phần điều khiển:**
  - Ô chọn loại chứng từ: `bill_of_lading` (Vận đơn đường biển), `sea_waybill`, `air_waybill` (Vận đơn hàng không), `fbl` (Đa phương thức FIATA), `cmr` (Đường bộ), `cim` (Đường sắt).
  - Bộ tải tệp chứng từ hãng tàu (PDF/Scan gốc) tích hợp `EvidenceSelector`.
  - Bộ nhập dữ liệu đối soát: Mã vận đơn, ngày cấp, hãng vận chuyển, tên tàu / số hiệu chuyến bay, cảng xếp / dỡ, số container và seal.
  - Nút "Đối soát chứng từ hãng tàu" (`Carrier Reconciliation Gate`): Tự động so sánh chênh lệch Gross Weight và CBM với Packing List.
  - Nút "Xuất Phụ lục Carbon Annex (XLSX)": Tạo bảng tính chi tiết chặng vận tải, hệ số phát thải GWP và nguồn dữ liệu (GLEC Framework / ISO 14083).

### Bước 2: Request Frontend (API Client)
- **Tệp client:** [`Weavecarbon/lib/weave-v2/shipmentExportApi.ts`](file:///D:/hoctap/WCB/Weavecarbon/lib/weave-v2/shipmentExportApi.ts).
- **Các hàm điều phối:**
  - `reconcileCarrierDocument(shipmentId, payload)`: Gửi thông tin đối soát carrier.
  - `generateShipmentExportDocument(shipmentId, 'carrier_carbon_annex', 'xlsx')`: Tạo phụ lục carbon.
  - `reviewShipmentExportDocument(shipmentId, docId, { reviewerRole: 'export_operator', decision: 'approved', notes })`: Ký xác nhận đối soát.

### Bước 3: Định Tuyến & Điều Khiển Backend (Route & Controller)
- **Định tuyến:** `BE_weavecarbon/src/routes/exportV2.js` và `src/services/carrierDocumentControls.js`.
- **Ràng buộc vai trò:** `export_operator` duyệt nghiệp vụ; `company_admin` phát hành.

### Bước 4: Xử Lý Nghiệp Vụ & Nguồn Dữ Liệu (Service & Data Source)
- **Dịch vụ chính:** [`BE_weavecarbon/src/services/carrierDocumentControls.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/carrierDocumentControls.js).
- **Quy tắc đối soát tự động nghiêm ngặt:**
  1. **Khớp phương thức vận tải:** Không chấp nhận `bill_of_lading` cho vận tải hàng không (`air`), không chấp nhận `air_waybill` cho vận tải đường biển/đường bộ.
  2. **Định dạng số AWB:** Nếu là hàng không, số vận đơn bắt buộc phải đúng 11 ký tự số (`^\d{11}$` theo chuẩn IATA).
  3. **Đối soát Container & Seal:** 100% số container và số chì trên vận đơn phải trùng khớp hoàn toàn (exact set match) với danh sách container trên Packing List (R02).
  4. **Dung sai trọng lượng (Weight Tolerance Gate):**
     - Cho phép sai số tối đa $\pm 1\%$ giữa Gross Weight trên vận đơn hãng tàu và Gross Weight trên Packing List (do sai số cân cầu cảng hoặc độ ẩm bốc hơi trong quá trình vận chuyển).
     - Nếu chênh lệch $> 1\%$, hệ thống kích hoạt cảnh báo đỏ và chặn không cho phê duyệt.
  5. **Dung sai thể tích (CBM Tolerance Gate):** Cho phép sai số tối đa $\pm 5\%$.
  6. **Liên kết bằng chứng:** Bắt buộc tệp scan gốc của hãng tàu phải có `evidenceDocumentId` hợp lệ, đã bị khóa (`locked`) và có mã băm SHA-256 trong Evidence Vault.

### Bước 5: Tạo Tệp Đầu Ra Thực Tế (Output Generation)
- **Tệp gốc hãng tàu:** Được bảo lưu nguyên trạng trong Vault, tải về kèm chữ ký số xác thực.
- **Tệp Phụ lục Carbon Annex (XLSX):**
  - Tiêu đề: `LOGISTICS CARBON EMISSIONS ANNEX - ISO 14083 / GLEC COMPLIANT`.
  - Sheet 1: `Summary & Methodology`: Tóm tắt tổng phát thải chặng biển/hàng không, hệ số phát thải áp dụng, nguồn cơ sở dữ liệu (EcoTransIT / GLEC).
  - Sheet 2: `Leg Details`: Phân rã từng chặng vận tải (Pre-carriage xe tải $\rightarrow$ Main carriage tàu biển $\rightarrow$ On-carriage).
  - Dấu bảo mật: `OFFICIAL CARBON ATTACHMENT - LINKED TO SHIPMENT & BILL OF LADING`.

### Bước 6: Thẩm Quyền & Chuỗi Khóa Bất Biến (Review & Issue Lifecycle)
- **Duyệt:** `export_operator` kiểm tra đối soát $Gross \le 1\%$, xác nhận vận đơn là bản gốc/bản điện tử hợp pháp.
- **Khóa:** Mã băm `carrierFileSha256` + `annexPayloadSha256` được niêm phong trong cơ sở dữ liệu.

### Bước 7: Bằng Chứng Kiểm Thử Tự Động (Test Coverage)
- **Tệp kiểm thử:** `BE_weavecarbon/tests/services/carrierDocumentControls.test.js`.
- **Kết quả:** Đạt **9/9 tests passed (100%)**:
  - `normalizes identifiers and sets without inventing metadata`
  - `passes a complete B/L only when carrier totals and equipment exactly reconcile`
  - `blocks mismatched containers, seals, packages, weight and authenticity`
  - `rejects bill_of_lading for incompatible mode air`
  - `rejects fbl for incompatible mode sea`
  - `rejects air_waybill for incompatible mode road`
  - `rejects cmr for incompatible mode rail`
  - `rejects cim for incompatible mode sea`
  - `requires an 11-digit AWB and air-specific flight fields`

---

## 3. Checklist Điều Kiện Nghiệm Thu Cho Pilot Thật

- [x] Tệp gốc hãng tàu được tiếp nhận và lưu trữ trong Evidence Vault có SHA-256.
- [x] Bộ máy đối soát kiểm tra số container, số seal và dung sai trọng lượng $\le 1\%$.
- [x] Ràng buộc chặt chẽ loại vận đơn với phương thức vận chuyển.
- [x] Sinh Phụ lục phát thải Carbon Annex (XLSX) chuẩn ISO 14083.
- [x] Test kiểm thử tự động 9/9 pass.
- [ ] Xác nhận thực địa lô hàng pilot với hãng tàu (MAEU, ONE hoặc MSC) trên môi trường Staging.

---

## 4. Kết Luận
Báo cáo R03 (Carrier Document & Carbon Annex) hoàn toàn sẵn sàng cho giai đoạn Pilot. Cơ chế bảo vệ không cấp vận đơn giả mạo mà tiếp nhận tệp gốc và cấp kèm Carbon Annex là lựa chọn kiến trúc chuẩn xác nhất về mặt pháp lý hàng hải quốc tế.
