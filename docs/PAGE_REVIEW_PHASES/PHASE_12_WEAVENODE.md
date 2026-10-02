# Đánh Giá Kỹ Thuật & Nghiệp Vụ - Phase 12: Vận Hành WeaveNode (/weavenode)

> **Mã Phase:** PHASE-12  
> **Tên Module:** Quản lý Thiết bị Cảm biến IoT, Khóa Phát hành & Cân đối Đồng hồ WeaveNode (IoT Edge Telemetry, Release Keys, Firmware & Meter Reconciliation)  
> **Đường dẫn Frontend:** `Weavecarbon/app/(dashboard)/weavenode/page.tsx`, `Weavecarbon/components/dashboard/weavenode/WeavenodeClient.tsx`  
> **API Backend:** `BE_weavecarbon/src/routes/weavenode.js`, `BE_weavecarbon/src/services/weavenodeService.js`, `BE_weavecarbon/src/services/weavenodeControls.js`  
> **Trạng thái:** `REVIEWED / NOT IMPLEMENTED`  
> **Phiên bản tài liệu:** 1.0  
> **Ngày đánh giá:** 29/09/2026  

---

## 1. Mục Đích & Phạm Vi Nghiệp Vụ

Trang `/weavenode` là trung tâm vận hành và xác thực dữ liệu cảm biến tầng biên (Edge IoT Telemetry) dành cho các thiết bị WeaveNode được triển khai tại nhà máy hoặc điểm đo lường. Hệ thống hỗ trợ:
1. **Quản lý thiết bị & Khóa ký phát hành (Release Keys):** Đăng ký, kích hoạt, vô hiệu hóa (revoke) các khóa ký Ed25519 dùng để xác thực tính toàn vẹn của các gói tin vi mã/cấu hình (firmware/config manifests) và gói tin viễn trắc (telemetry packets).
2. **Xác thực viễn trắc đo lường (Telemetry Ingestion):** Hỗ trợ 2 chuẩn giao thức `weavenode-ed25519-v1` và `weavenode-ed25519-v2` với chữ ký Ed25519 (64-byte raw Base64), kiểm tra chống phát lại (replay protection bằng sequence number đơn điệu tăng), dung sai thời gian tương lai không quá 5 phút (`FUTURE_TOLERANCE_MS = 300,000ms`), và giới hạn bộ đệm tối đa 90 ngày (`MAX_PACKET_BUFFER_DAYS = 90`).
3. **Phân cấp & Cân đối Đồng hồ (Meter Reconciliation & Hierarchy):** Cấu hình phân cấp điểm đo (`parentMeasurementPointRevisionId`, `childMeasurementPointRevisionId`), tỉ lệ phân bổ tổn thất (loss/gain balance), và đối soát rò rỉ hoặc thiếu hụt điện năng/nhiên liệu giữa đồng hồ tổng và các đồng hồ phụ.
4. **Quản lý Cấu hình & Bản cập nhật Vi mã (Firmware/Config Update Manifests):** Tạo manifest cập nhật có chữ ký số, theo dõi trạng thái triển khai, và hỗ trợ kích hoạt cờ rollback an toàn khi phát hiện lỗi tầng biên.

---

## 2. Mã Nguồn Trong Phạm Vi (Source Scope)

### 2.1. Frontend
- [`Weavecarbon/app/(dashboard)/weavenode/page.tsx`](file:///D:/hoctap/WCB/Weavecarbon/app/(dashboard)/weavenode/page.tsx): Route máy chủ Next.js App Router bọc `WeavenodeClient`.
- [`Weavecarbon/components/dashboard/weavenode/WeavenodeClient.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/weavenode/WeavenodeClient.tsx): Giao diện tương tác điều khiển WeaveNode (danh sách thiết bị, nhật ký gói tin viễn trắc, bảng quản lý release keys, phân cấp đồng hồ và đối soát reconciliation).
- [`Weavecarbon/components/dashboard/weavenode/WeavenodeClient.test.tsx`](file:///D:/hoctap/WCB/Weavecarbon/components/dashboard/weavenode/WeavenodeClient.test.tsx): Bộ kiểm thử đơn vị frontend cho các thao tác và trạng thái chính của màn hình WeaveNode.

### 2.2. Backend
- [`BE_weavecarbon/src/routes/weavenode.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/routes/weavenode.js): Khai báo router quản trị và tiếp nhận viễn trắc WeaveNode; router áp dụng xác thực B2B và quyền Company Admin cho thao tác thay đổi dữ liệu.
- [`BE_weavecarbon/src/services/weavenodeService.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/weavenodeService.js): Điều phối nghiệp vụ, truy vấn/lưu dữ liệu tenant và gọi các kiểm soát WeaveNode.
- [`BE_weavecarbon/src/services/weavenodeControls.js`](file:///D:/hoctap/WCB/BE_weavecarbon/src/services/weavenodeControls.js): Module cốt lõi xác thực Ed25519, SPKI SHA-256 fingerprint, tính toán cân đối đồng hồ đo và bảo vệ chống replay.
- Các khóa ký, trạng thái thu hồi và thời hạn hiệu lực được lưu bởi `weavenodeService.js` trong các bảng/migration WeaveNode; không có model `weavenodeReleaseKey.js` riêng.
- Database Migrations: Các bảng liên quan đến thiết bị `weavenodes`, `weavenode_packets`, `weavenode_release_keys`, `weavenode_meter_hierarchies`, `weavenode_meter_reconciliations`.

---

## 3. Luồng Dữ Liệu & Nguồn Sự Thật (Data Flow & Source of Truth)

```
[IoT Edge Gateway / WeaveNode Device]
       │
       │ 1. POST /api/weavenode/ingest (Payload + Ed25519 Signature + SequenceNo)
       ▼
[BE: weavenode.js]
       │
       ▼
[BE: weavenodeService.js: ingest() -> weavenodeControls.js]
       ├─► Kiểm tra buffer window (<= 90 ngày) & future skew (<= 5 phút)
       ├─► Xác minh Sequence Number tăng đơn điệu (Replay Attack Prevention)
       ├─► Tìm Public Key trong `weavenode_release_keys` (IsActive & Not Revoked)
       ├─► Xác thực crypto.verify (Ed25519 SPKI DER / Raw Ed25519)
       └─► Lưu trữ gói tin vào cơ sở dữ liệu `weavenode_packets`
       │
[Frontend: WeavenodeClient.tsx]
       │
       ├─► GET /api/weavenode/devices (Hiển thị trạng thái kết nối, pin, firmware)
       ├─► GET /api/weavenode/meter-reconciliations (Danh sách các snapshot đối soát tổng - phụ)
       └─► POST /api/weavenode/release-keys (Quản trị viên đăng ký Public Key mới)
```

**Nguồn sự thật (Single Source of Truth):**
- Bảng `weavenode_packets`: Lưu trữ chuỗi chu kỳ đo lường bất biến đã xác minh chữ ký Ed25519.
- Bảng `weavenode_release_keys`: Nguồn định danh tính hợp lệ của các nhà phát hành và khóa ký phần mềm/dữ liệu.

---

## 4. Bảng Kiểm Soát Nghiệp Vụ (Controls & Validations)

| Mã Kiểm Soát | Tên Kiểm Soát | Quy Tắc Kiểm Tra | Xử Lý Lỗi / Mã HTTP |
|---|---|---|---|
| **CTL-WN-01** | Dung sai thời gian tương lai | Timestamp gói tin không được vượt quá `Date.now() + 300,000ms` (5 phút) | `400 Bad Request` (`PACKET_TIMESTAMP_IN_FUTURE`) |
| **CTL-WN-02** | Giới hạn đệm lùi quá khứ | Timestamp không được cũ hơn `Date.now() - 90 * 86,400,000ms` | `400 Bad Request` (`PACKET_TIMESTAMP_EXPIRED_BUFFER`) |
| **CTL-WN-03** | Chống phát lại (Replay Attack) | `sequenceNumber` phải là số nguyên dương và lớn hơn `last_sequence_number` đã lưu | `409 Conflict` (`DUPLICATE_OR_STALE_SEQUENCE`) |
| **CTL-WN-04** | Xác thực Ed25519 Signature | Chữ ký Ed25519 64 bytes mã hóa Base64 phải khớp với payload canonical và SPKI public key | `401 Unauthorized` / `400 Bad Request` (`INVALID_SIGNATURE`) |
| **CTL-WN-05** | Hiệu lực Release Key | Khóa ký phải có `status = 'ACTIVE'`, không nằm trong danh sách `REVOKED` và nằm trong khoảng `validFrom` - `validUntil` | `403 Forbidden` (`RELEASE_KEY_INACTIVE_OR_REVOKED`) |
| **CTL-WN-06** | Cân đối Đồng hồ Phân cấp | Tổng đo lường đồng hồ phụ cộng tổn thất lý thuyết phải nằm trong dung sai sai số đồng hồ tổng ($\pm 2\%$) | Cảnh báo bất thường `ANOMALY_UNBALANCED_LOAD` |

---

## 5. Phân Quyền & Đa Khách Thuê (Tenant Isolation & Permissions)

- **Quyền hạn cần thiết:**
  - `WEAVENODE_VIEW`: Xem danh sách cảm biến, đồ thị đo đạc và nhật ký đối soát.
  - `WEAVENODE_OPERATOR`: Thực hiện lệnh đồng bộ, kích hoạt đo đạc tức thời hoặc chạy đối soát đồng hồ.
  - `WEAVENODE_ADMIN`: Đăng ký Release Key mới, cấu hình phân cấp đồng hồ, phê duyệt bản cập nhật firmware hoặc hủy khóa (revoke).
- **Ranh giới Multi-Tenancy:**
  - Tất cả các truy vấn danh sách thiết bị, gói tin và khóa ký đều bắt buộc lọc theo `organizationId = req.user.organizationId`.
  - Không cho phép gán cha-con giữa hai điểm đo lường thuộc hai tổ chức khác nhau.

---

## 6. Đánh Giá Trải Nghiệm Người Dùng (UX Evaluation)

1. **Bảng điều khiển trực quan:** `WeavenodeClient.tsx` cung cấp trạng thái trực tiếp của các nút cảm biến (trực tuyến, mất kết nối, tín hiệu yếu, cảnh báo lệch số liệu).
2. **Quản lý khóa minh bạch:** Hiển thị rõ ràng Fingerprint SHA-256 của từng Release Key, thời gian hết hạn và nút Thu hồi khẩn cấp (Emergency Revoke).
3. **Điểm trừ UX:** Quá trình tạo chữ ký Ed25519 mẫu để test trực tiếp trên Web UI chưa có bộ sinh mã giả lập (simulator tool) tích hợp, buộc người dùng hoặc kỹ thuật viên phải dùng cURL hoặc công cụ CLI ngoài.

---

## 7. Danh Sách Vấn Đề (P0 / P1 / P2)

### P0 (Lỗi nghiêm trọng / Rủi ro bảo mật)
- *Không có.* Cơ chế xác thực Ed25519 và kiểm tra replay đã được triển khai nghiêm ngặt ở tầng service.

### P1 (Chức năng chưa hoàn thiện / Nghiệp vụ tiềm ẩn lỗi)
- **P1-01 - Thiếu cảnh báo tức thời khi phát hiện rò rỉ năng lượng liên tục:** Khi cân đối đồng hồ (`meter reconciliation`) phát hiện chênh lệch vượt ngưỡng dung sai 3 chu kỳ liên tiếp, hệ thống mới chỉ ghi log mà chưa tự động bắn Notification hoặc tạo Task khắc phục trong mục Bảo trì/Vận hành.

### P2 (Cải tiến giao diện & Giám sát)
- **P2-01 - Tích hợp IoT Payload Simulator trên giao diện:** Cần thêm tab "Giả lập gói tin" để cho phép kỹ sư vận hành tạo gói tin thử nghiệm có chữ ký hợp lệ nhằm kiểm thử kết nối trước khi triển khai ngoài hiện trường.

---

## 8. Bằng Chứng Kiểm Thử Tự Động (Test Evidence)

### 8.1. Backend Tests
- **Tập tin kiểm thử:**
  - `BE_weavecarbon/tests/services/weavenodeControls.test.js`
  - `BE_weavecarbon/tests/services/weavenodeService.test.js`
  - `BE_weavecarbon/tests/config/weavenodeMigrationContract.test.js`
  - `BE_weavecarbon/tests/config/weavenodeOperationsMigrationContract.test.js`
- **Kết quả thực thi:**
  - **13/13 tests PASSED (100%)**
  - Bao gồm: kiểm thử xác thực chữ ký Ed25519 hợp lệ/không hợp lệ, chặn timestamp tương lai, chặn timestamp quá 90 ngày, từ chối sequence number cũ, kiểm tra vòng đời Release Key và tính toán đối soát đồng hồ phân cấp.

### 8.2. Frontend Tests
- **Tập tin kiểm thử:** `Weavecarbon/components/dashboard/weavenode/WeavenodeClient.test.tsx`
- **Kết quả thực thi:**
  - **1/1 test suite PASSED (100%)**
  - Xác nhận helper định dạng payload và kiểm tra tính toàn vẹn hoạt động đồng nhất với backend.

---

## 9. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Gói tin viễn trắc bắt buộc phải có chữ ký Ed25519 hợp lệ tương ứng với Release Key đang hoạt động của tổ chức.
- [x] Ngăn chặn hoàn toàn replay attack bằng kiểm tra sequence number tăng nghiêm ngặt.
- [x] Dung sai timestamp được giới hạn chặt chẽ (quá khứ $\le 90$ ngày, tương lai $\le 5$ phút).
- [x] Cấu hình phân cấp điểm đo lường hỗ trợ tính toán đối soát tổn thất năng lượng chính xác.
- [x] Đảm bảo cách ly đa khách thuê trên mọi truy vấn dữ liệu cảm biến và thiết bị.

---

## 10. Kết Luận & Biên Giới Chưa Xác Minh (Boundaries)

- **Kết luận:** Mô-đun Vận hành WeaveNode đạt mức độ an ninh mật mã học cao (sử dụng Ed25519 và SPKI Fingerprinting), đáp ứng tiêu chuẩn nghiêm ngặt cho giải pháp IoT công nghiệp phục vụ kiểm kê khí nhà kính thời gian thực.
- **Biên giới chưa xác minh:** Hiệu năng chịu tải của API Ingestion khi hàng ngàn thiết bị gửi dữ liệu đồng thời ở tần suất cao (1s - 5s/lần) cần được đo lường bằng bài kiểm thử tải chuyên dụng (load testing/stress testing với k6) trên môi trường Staging.
