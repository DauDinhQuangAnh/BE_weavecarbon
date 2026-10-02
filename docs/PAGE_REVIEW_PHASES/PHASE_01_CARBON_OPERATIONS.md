# Phase 01 - Rà soát trang Vận hành carbon

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang | Vận hành carbon |
| Route frontend | `/carbon-operations` |
| Ngày rà soát | 2026-09-26 |
| Trạng thái rà soát | REVIEWED |
| Trạng thái triển khai sửa | IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING |
| Mức sẵn sàng hiện tại | PARTIAL - phù hợp pilot quản trị nội bộ |
| Thay đổi code trong phase | Có - frontend, backend validation và test |

Các mục 2-10 giữ lại kết quả rà soát ban đầu để làm mốc so sánh trước triển khai. Kết quả code và kiểm thử mới nhất được ghi tại mục 12.

## 2. Mục đích thực tế của trang

Trang hiện phục vụ sáu nhóm công việc:

1. Khai báo revision cơ sở hoặc nhà máy.
2. Khai báo revision quy trình sản xuất.
3. Khai báo revision điểm đo.
4. Xem activity ledger và dữ liệu truy vết.
5. Tạo revision quy tắc phân bổ carbon.
6. Tạo snapshot phân bổ từ activity nguồn xuống các quy trình.

Với chức năng hiện tại, đây chủ yếu là console cấu hình dữ liệu carbon nền tảng dành cho quản trị viên. Tên "Vận hành carbon" rộng hơn nội dung thực tế vì trang chưa có cảnh báo vận hành, hàng đợi công việc, sự cố điểm đo, chất lượng dữ liệu theo thời gian hoặc tình trạng nhà máy.

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend

- `Weavecarbon/app/(dashboard)/carbon-operations/page.tsx`
- `Weavecarbon/app/demo/carbon-operations/page.tsx`
- `Weavecarbon/components/dashboard/carbon-operations/CarbonOperationsClient.tsx`
- `Weavecarbon/components/dashboard/carbon-operations/CarbonOperationsClient.test.tsx`
- `Weavecarbon/lib/industrialCoreApi.ts`
- `Weavecarbon/locales/vi/common.json`

### Backend

- `BE_weavecarbon/src/routes/industrialCore.js`
- `BE_weavecarbon/src/routes/dynamicAllocation.js`
- `BE_weavecarbon/src/services/industrialCoreControls.js`
- `BE_weavecarbon/src/services/industrialCoreService.js`
- `BE_weavecarbon/src/services/dynamicAllocationControls.js`
- `BE_weavecarbon/src/services/dynamicAllocationService.js`
- `BE_weavecarbon/migrations/038_g2_industrial_core_baseline.sql`
- `BE_weavecarbon/migrations/039_g2_industrial_activity_review.sql`
- `BE_weavecarbon/migrations/046_g2_dynamic_allocation_lineage.sql`

## 4. Luồng tải dữ liệu tại thời điểm rà soát

Frontend tải song song các nguồn sau bằng `Promise.all`:

- capability registry;
- facilities;
- processes;
- measurement points;
- activities, giới hạn 100 bản ghi;
- allocation rules;
- allocation runs, giới hạn 100 bản ghi.

Nếu một request thất bại, toàn bộ lần tải được coi là thất bại. Trang không có nút thử lại và không giữ trạng thái lỗi riêng cho từng khu vực.

Ở demo mode, trang chỉ hiển thị capability registry. Toàn bộ danh sách nghiệp vụ rỗng và các control ghi dữ liệu bị vô hiệu hóa.

## 5. Kiểm tra toàn bộ chức năng và nút bấm

| Chức năng hoặc nút | API backend | Kết quả đánh giá | Vấn đề cần xử lý sau |
|---|---|---|---|
| Tạo cơ sở | `POST /api/industrial-core/facilities` | Có FE và BE | Timezone luôn là `Asia/Ho_Chi_Minh`, lifecycle luôn là `active`; không phù hợp cơ sở ở quốc gia khác |
| Tạo quy trình | `POST /api/industrial-core/processes` | Có FE và BE | Chọn đúng facility revision nhưng chưa phân biệt rõ revision hiện hành và revision lịch sử |
| Tạo điểm đo | `POST /api/industrial-core/measurement-points` | Có FE và BE | FE luôn gửi `sourceType=meter`; không cho chọn PLC, sensor, WeaveNode, manual hoặc API; thiếu thông tin calibration và sampling |
| Xem truy vết | `GET /api/industrial-core/activities/:activityId/lineage` | Có FE và BE | Hiển thị nguyên JSON kỹ thuật, chưa có bảng chứng từ, checksum, review và nguồn dữ liệu dễ đọc |
| Tạo revision quy tắc | `POST /api/dynamic-allocation/rules` | Có FE và BE | FE chỉ hỗ trợ `facility -> process`; evidence được nhập bằng UUID thô |
| Tạo allocation snapshot | `POST /api/dynamic-allocation/runs` | Có FE và BE | Chỉ dùng activity nguồn và process target; chưa dùng được chuỗi phân bổ nhiều tầng mà BE hỗ trợ |
| Tạo activity | `POST /api/industrial-core/activities` | Chỉ có BE | FE không có form hoặc luồng ingest tương ứng |
| Review activity | `POST /api/industrial-core/activities/:activityId/reviews` | Chỉ có BE | FE không có approve, reject hoặc needs-information |
| Refresh hoặc thử lại | Không cần API mới | Chưa có | Người dùng phải tải lại cả trang khi request lỗi |
| Tìm kiếm, lọc, phân trang | BE mới có limit ở một số danh sách | Chưa có | Không phù hợp khi số activity và allocation run tăng lớn |
| Sửa hoặc xóa | Không hỗ trợ theo chủ đích | Hợp lý | Phải giải thích rõ rằng thay đổi được thực hiện bằng revision mới vì dữ liệu là append-only |

## 6. Kiểm tra quyền truy cập

Backend áp dụng:

- tất cả endpoint yêu cầu đăng nhập;
- người dùng phải thuộc role B2B;
- các endpoint tạo facility, process, measurement point, activity, activity review, allocation rule và allocation run yêu cầu Company Admin;
- endpoint đọc cho phép người dùng B2B hợp lệ trong company hiện hành.

Frontend không đọc quyền Company Admin để ẩn hoặc khóa form. Vì vậy người không có quyền vẫn thấy nút tạo và chỉ phát hiện vấn đề sau khi backend trả lỗi 403.

Kết luận: kiểm soát quyền ở backend đúng hướng, nhưng trải nghiệm và trạng thái quyền trên frontend chưa đúng.

## 7. Kiểm tra logic dữ liệu backend

### Phần đã hợp lý

- Mọi truy vấn nghiệp vụ đều gắn với `companyId`.
- Facility, process, measurement point, activity, activity review, allocation rule, run và line được lưu theo mô hình append-only hoặc revision bất biến.
- Trigger database chặn update và delete với các ledger bất biến.
- Process và measurement point được kiểm tra thuộc đúng facility/company.
- Allocation rule approved yêu cầu evidence thuộc company hiện hành, ở trạng thái `locked` hoặc `third_party_verified`, có SHA-256 và kích thước file lớn hơn 0.
- Allocation run chỉ dùng rule approved.
- Nguồn, rule, target và company được kiểm tra trước khi phân bổ.
- Payload, rule và allocation line có hash; run trùng payload được tái sử dụng.
- Kết quả phân bổ lưu driver, tỷ lệ, số lượng được phân bổ và chênh lệch reconciliation.

### Phần BE hỗ trợ nhưng FE chưa khai thác

- Tạo activity.
- Review activity bất biến.
- Nguồn điểm đo gồm `meter`, `plc`, `sensor`, `weavenode`, `manual`, `api`.
- Chuỗi allocation nhiều tầng: facility đến process/batch/product, process đến batch/product và batch đến product.
- Tiếp tục allocation từ một allocation line trước đó.

## 8. Các phát hiện cần sửa khi triển khai

### P0 - Chặn việc đánh dấu production-ready

1. Đồng bộ quyền Company Admin trên giao diện; người chỉ có quyền đọc phải thấy trạng thái read-only và lý do rõ ràng.
2. Bổ sung luồng tạo hoặc ingest activity và review activity, hoặc chỉ rõ activity được tạo ở trang/hệ thống nào kèm liên kết điều hướng.
3. Thay ô nhập Evidence UUID bằng bộ chọn evidence đã khóa hoặc đã xác minh.
4. Cho khai báo timezone thực tế của facility.
5. Chuyển activity lineage từ JSON sang giao diện nghiệp vụ.
6. Phân biệt rõ capability của toàn nền tảng với readiness của company/facility hiện hành.

### P1 - Cần hoàn thiện cho vận hành thường xuyên

1. Cho chọn source type và bổ sung calibration status, calibration due date, sampling interval, device identity.
2. Đánh dấu revision hiện hành và tránh vô tình liên kết dữ liệu mới với revision cũ.
3. Thêm tìm kiếm, bộ lọc, phân trang và nút thử lại.
4. Hiển thị thông báo thành công sau thao tác ghi.
5. Tách lỗi theo từng form; không dùng chung thông báo "Không thể tạo phiên bản cơ sở" cho process và measurement point.
6. Cân nhắc tách phần cấu hình master data khỏi màn hình theo dõi vận hành.
7. Bổ sung trạng thái loading riêng cho từng thao tác thay vì khóa toàn bộ form bằng một biến `saving` chung.

### P2 - Mở rộng sau pilot

1. Giao diện chuỗi allocation nhiều tầng.
2. Dashboard chất lượng dữ liệu, điểm đo mất tín hiệu và activity chờ review.
3. Theo dõi task, người phụ trách và thời hạn xử lý.
4. Demo có dữ liệu giả được ghi nhãn rõ để người dùng hiểu trọn luồng nghiệp vụ.

## 9. Kết quả test tại thời điểm rà soát

### Frontend

Lệnh:

```powershell
& 'D:\hoctap\node\node.exe' '.\node_modules\vitest\vitest.mjs' run components/dashboard/carbon-operations/CarbonOperationsClient.test.tsx
```

Kết quả: 1 test file đạt, 3/3 test đạt.

Giới hạn: test hiện chỉ đọc source và kiểm tra chuỗi contract. Test chưa render component, nhập form, bấm nút, giả lập quyền hoặc xác nhận lỗi API.

### Backend

Lệnh:

```powershell
& 'D:\hoctap\node\node.exe' '.\node_modules\jest\bin\jest.js' --runInBand tests/services/industrialCoreControls.test.js tests/services/industrialCoreService.test.js tests/services/dynamicAllocationControls.test.js tests/services/dynamicAllocationService.test.js tests/config/industrialCoreMigrationContract.test.js tests/config/industrialActivityReviewMigrationContract.test.js tests/config/dynamicAllocationMigrationContract.test.js
```

Kết quả: 7/7 test suite đạt, 22/22 test đạt.

Chưa thực hiện trong phase này:

- kiểm thử trình duyệt với tài khoản Company Admin;
- kiểm thử tài khoản chỉ có quyền đọc;
- kiểm thử API với database thật;
- kiểm thử migration trên staging;
- kiểm thử tải lớn và phân trang;
- kiểm thử end-to-end từ evidence đến activity review và allocation.

## 10. Kết luận tại thời điểm rà soát trước triển khai

| Hạng mục | Kết luận |
|---|---|
| Ý tưởng nghiệp vụ | Hợp lý nhưng phạm vi trang giống console quản trị dữ liệu hơn dashboard vận hành |
| Frontend | PARTIAL |
| Backend cho chức năng đã nối lên FE | Cơ bản tốt |
| Backend cho toàn bộ vòng đời nghiệp vụ | Có nhiều chức năng hơn FE nhưng chưa được nối thành luồng hoàn chỉnh |
| Phân quyền end-to-end | PARTIAL |
| Khả năng dùng cho pilot nội bộ | Có |
| Khả năng dùng production | Chưa |

Quyết định tại thời điểm rà soát: giữ nguyên code và đưa thay đổi sang giai đoạn triển khai. Quyết định này đã được thay thế bởi kết quả triển khai tại mục 12 sau khi người dùng cho phép bắt đầu Phase 1.

## 11. Checklist nghiệm thu cho giai đoạn triển khai sau

- [x] Người đọc không có quyền admin không thể thao tác ghi và hiểu rõ lý do (đã xác minh bằng code và component test cục bộ).
- [x] Company Admin có form tạo facility với country và timezone IANA hợp lệ.
- [x] Company Admin tạo process trên revision hiện hành được chọn rõ ràng.
- [x] Điểm đo hỗ trợ source type, device identity, calibration và sampling interval.
- [x] Activity có form tạo, SHA-256 provenance, evidence và luồng review.
- [x] Lineage hiển thị dễ đọc, bao gồm evidence, checksum và review mới nhất.
- [x] Approved allocation rule chỉ chọn evidence có kiểm soát; backend vẫn là lớp kiểm tra cuối.
- [x] Allocation run hiển thị nguồn, target, driver, tỷ lệ và reconciliation.
- [x] Lỗi của một khu vực không làm mất dữ liệu đã tải thành công ở khu vực khác và có nút thử lại.
- [ ] Có test component cho mọi nút và test quyền admin/read-only.
- [ ] Có test tích hợp API và database cho tenant isolation.
- [ ] Có kết quả kiểm thử staging trước khi đổi trạng thái sang VERIFIED ON STAGING hoặc ACCEPTED.

## 12. Kết quả triển khai ngày 2026-09-26

Phần triển khai cục bộ đã xử lý các mục P0 và P1 đã thống nhất:

- đồng bộ quyền ghi với Company Admin và subscription lock; người còn lại thấy trạng thái chỉ đọc;
- tải dữ liệu độc lập bằng `Promise.allSettled`, giữ phần tải thành công, hiển thị lỗi từng khu vực và cho thử lại;
- nhập timezone IANA cho facility và kiểm tra lại ở backend;
- chuyển kỳ activity từ giờ địa phương của facility sang UTC và lưu timezone trong provenance;
- chọn revision hiện hành, mở rộng thông tin điểm đo và kiểm tra quan hệ facility - process - measurement point ở backend;
- tạo activity với canonical provenance SHA-256 được backend xác minh lại, evidence, tìm kiếm, phân trang cục bộ, popup lineage và review;
- thay UUID evidence thô của allocation rule bằng danh sách evidence có kiểm soát;
- bổ sung loading, lỗi và thông báo thành công theo từng thao tác.

Các file triển khai chính:

- frontend: `CarbonOperationsClient.tsx`, `ActivityOperationsPanel.tsx`, `industrialCoreApi.ts`, `industrialOperations.ts` và bản dịch tiếng Việt;
- backend: `industrialCoreControls.js`, `industrialCoreService.js`;
- test: component/contract/helper frontend và unit/service backend.

### Bằng chứng kiểm thử cục bộ

| Cổng kiểm tra | Kết quả |
|---|---|
| Frontend tập trung | 3 file, 10/10 test đạt |
| Backend tập trung | 7 suite, 27/27 test đạt |
| Frontend toàn bộ | 77 file, 282/282 test đạt |
| Backend toàn bộ | 176 suite, 958/958 test đạt |
| Frontend `npm run check` | Đạt; lint có 29 warning tồn tại ngoài phạm vi Phase 1, không có error |
| Backend `npm run verify` | Đạt: syntax, OpenAPI, artifact, module boundaries và lint |
| Frontend production build | Chưa xác minh được do môi trường không tải được Be Vietnam Pro từ `fonts.gstatic.com`; TypeScript và các cổng kiểm tra khác đều đạt |

### Phạm vi còn lại

- Chưa chạy migration/API với database staging thật và chưa kiểm thử bằng hai tài khoản Company Admin/read-only trên trình duyệt.
- Chưa kiểm thử tải lớn hoặc phân trang phía server; giao diện activity hiện phân trang trên tối đa 500 bản ghi đã tải.
- Các mục P2 như allocation nhiều tầng, dashboard cảnh báo chất lượng dữ liệu, task owner/SLA và demo dataset vẫn để sau pilot.
- Vì vậy trạng thái hiện tại là `IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING`, chưa phải `VERIFIED ON STAGING` hoặc `ACCEPTED`.
