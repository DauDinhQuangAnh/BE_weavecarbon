# Phase 03 - Logistics

## 1. Trạng thái

`IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING`

Ngày rà soát và triển khai: 2026-09-26.

Phase này kiểm tra `/logistics` cùng các route con `/assessment`, `/transport`, `/track-shipment` và các route demo tương ứng. Phạm vi gồm giao diện, nút bấm, luồng dữ liệu, quyền ghi, vòng đời shipment, bản đồ, ước tính phát thải và backend liên quan.

## 2. Vai trò thực tế của từng trang

| Trang | Vai trò đúng trong hệ thống |
|---|---|
| `/logistics` | Danh mục vận hành lô hàng: tổng quan, tìm/lọc, xem tuyến, chi tiết, QR và thay đổi trạng thái |
| `/assessment` | Wizard sáu bước để tạo hoặc cập nhật dữ liệu sản phẩm; logistics là một bước của assessment, không phải màn CRUD shipment độc lập |
| `/transport` | Cấu hình và ước tính các chặng vận chuyển của một sản phẩm, sau đó lưu lại vào sản phẩm |
| `/track-shipment` | Theo dõi tiến độ suy ra từ trạng thái và lịch mô phỏng, xem tuyến/chặng và hủy lô hợp lệ |
| `/demo/*` | Chạy cùng giao diện bằng demo adapter và dữ liệu cục bộ, không ghi vào backend production; trang transport không lưu sản phẩm demo |

Shipment được tạo chủ yếu từ luồng publish sản phẩm/lô hàng hoặc qua logistics API. Trang `/transport` không tạo shipment trực tiếp; nó cập nhật dữ liệu logistics của sản phẩm để backend tính và đồng bộ theo luồng sản phẩm.

## 3. Luồng dữ liệu và backend

### Logistics API

- `GET /api/logistics/overview`: thống kê theo company.
- `GET /api/logistics/shipments`: tìm kiếm, lọc trạng thái/phương thức, sắp xếp và phân trang.
- `GET /api/logistics/shipments/:id`: shipment cùng legs và products.
- `POST /api/logistics/shipments`: tạo shipment trong transaction.
- `PATCH /api/logistics/shipments/:id`: sửa metadata khi shipment còn `pending`.
- `PATCH /api/logistics/shipments/:id/status`: chuyển trạng thái theo state machine.
- `PUT /api/logistics/shipments/:id/legs`: thay chặng khi shipment còn `pending`.
- `PUT /api/logistics/shipments/:id/products`: thay sản phẩm khi shipment còn `pending`.

Không có API xóa cứng shipment. Hành vi vận hành đúng là chuyển sang `cancelled` để giữ lịch sử và dấu vết tham chiếu.

### Vòng đời

Shipment thủ công dùng chuỗi:

`pending -> in_transit -> delivered`

Từ `pending` hoặc `in_transit` có thể chuyển sang `cancelled`. `delivered` và `cancelled` là trạng thái cuối.

Shipment mô phỏng được backend tính `pending_until` và `estimated_arrival_at` theo giờ làm việc. Trạng thái của shipment mô phỏng tự chuyển theo thời gian; người dùng chỉ được hủy khi nó vẫn còn `pending`.

Sau triển khai, metadata, legs và products chỉ sửa được ở `pending`. Câu lệnh đổi trạng thái kiểm tra lại trạng thái cũ ngay trong `UPDATE`, nên hai yêu cầu đồng thời không thể cùng ghi đè thành công. Các câu lệnh cập nhật cuối luôn có `company_id`.

### Quyền và tenant

- Middleware xác thực gắn `companyId` và `companyRole` từ membership đang hoạt động.
- `tenantAccess` chặn mutation của role `viewer` trên `/api/logistics`.
- Subscription middleware chặn mutation khi gói đã khóa.
- Các truy vấn shipment, sản phẩm liên kết và cập nhật đều có company scope.
- Frontend hiển thị trạng thái chỉ xem và khóa các nút thay đổi dữ liệu.

## 4. Kiểm tra chức năng và nút bấm

### `/logistics`

| Khu vực | Chức năng | Kết quả sau triển khai |
|---|---|---|
| Header | Cập nhật | Giữ dữ liệu cũ nếu một API lỗi; hiện cảnh báo và nút thử lại |
| KPI | Tổng lô/trạng thái/CO₂e | Hoạt động; CO₂e được ghi rõ là ước tính và không cộng shipment đã hủy |
| Tìm kiếm | Mã lô, thành phố, quốc gia | Hoạt động trên tập shipment đã tải |
| Lọc thị trường | US, EU, JP, KR, VN | Hoạt động trên destination |
| Lọc phương thức | Road, sea, air, rail | Đã sửa để gửi `transport_mode` đến backend |
| Tab | Đang vận chuyển/Lịch sử | Mặc định mở tab đang hoạt động; số lượng theo tập đang lọc |
| Card shipment | Mở chi tiết | Hoạt động, tải legs/products theo ID |
| Card shipment | QR | Chỉ sinh QR khi tìm được sản phẩm thật trong shipment |
| Card shipment | Bắt đầu | `pending -> in_transit`; không còn nhảy thẳng sang delivered |
| Card shipment | Đã giao | Chỉ hiện cho `in_transit` thủ công |
| Card shipment | Hủy | Có confirm; hỗ trợ pending thủ công/mô phỏng và in-transit thủ công |
| Bản đồ | Tuyến và focus shipment | Dùng phương thức chặng đầu từ backend; không còn đoán mọi tuyến quốc tế là đường biển |
| Bản đồ | Tọa độ 0 | Đã sửa kiểm tra null để vĩ độ/kinh độ bằng 0 vẫn hợp lệ |
| Chế độ chỉ xem | Mutation | Có banner và các nút thay đổi bị khóa |

### `/assessment`

Wizard sáu bước đã có điều hướng quay lại/tiếp tục, lưu nháp, publish, kiểm tra permission và thông báo lỗi. Bước logistics dùng location picker, gợi ý tuyến nội địa/xuất khẩu và intermodal planner. Kết quả cuối được lưu qua product API; nguồn carbon chính thức vẫn do backend tính lại theo cơ chế authoritative của Phase 02.

Route suggestion là công cụ hỗ trợ nhập liệu. Tuyến fallback hoặc hệ số proxy không phải dữ liệu thực đo của hãng vận chuyển và không được xem là bằng chứng kiểm toán.

### `/transport`

| Chức năng | Kết quả sau triển khai |
|---|---|
| Chọn domestic/international | Hợp lý cho việc khởi tạo chặng |
| Thêm/xóa chặng | Hoạt động; luôn giữ ít nhất một chặng |
| Chọn road/ship/air/rail | Hoạt động; biểu tượng rail đã sửa đúng |
| Nhập điểm đi/đến và tọa độ | Hoạt động |
| Tính tuyến road | Có retry, cache, giới hạn concurrency và cảnh báo khi không xác nhận được tuyến |
| CO₂e preview | Hiển thị rõ là ước tính; không còn gắn độ tin cậy cao chỉ vì một cờ quyền vị trí |
| Xin quyền vị trí | Đã bỏ luồng giả vì trước đó không gọi Geolocation API và không dùng vị trí thiết bị |
| Lưu và xem | Cập nhật sản phẩm khi có `productId`; role chỉ xem/demo không thể lưu |
| Không có product | Nút chuyển đến lịch sử tính toán, không tạo dữ liệu giả |

### `/track-shipment`

| Chức năng | Kết quả sau triển khai |
|---|---|
| Tải toàn bộ shipment detail | Có giới hạn concurrency; lỗi không xóa dữ liệu cũ |
| Loading/lỗi/thử lại | Đã bổ sung trạng thái hiển thị rõ |
| Chọn shipment từ URL | Đã sửa để nhận cả UUID backend và reference number |
| Tìm kiếm/lọc trạng thái | Hoạt động |
| Bản đồ và timeline | Hiển thị từ legs và trạng thái shipment |
| Vị trí hiện tại | Đã ghi rõ đây là vị trí ước tính từ trạng thái/tuyến, không phải GPS hãng vận chuyển |
| Xem logistics/lịch sử carbon | Điều hướng theo shipment/product và demo route |
| Hủy shipment | Hỗ trợ manual pending/in-transit và simulated pending; có permission, confirm và busy guard |

## 5. Bản đồ, API ngoài và chủ quyền

- Bản đồ danh mục logistics dùng style OpenFreeMap và có màn lỗi, retry tự động giới hạn cùng nút retry thủ công.
- Bản đồ transport dùng Mapbox runtime. Việc thiếu token hoặc lỗi tải phải được kiểm tra bằng biến môi trường staging thật.
- Road routing dùng tối đa 3 lần thử, cache tối đa 200 tuyến, TTL 10 phút cho kết quả thành công và 30 giây cho lỗi.
- Hook resolve nhiều tuyến giới hạn concurrency là 3; trang logistics chỉ resolve tối đa 8 tuyến road đang hiển thị.
- Tuyến road lỗi có fallback hình học và cảnh báo, nên fallback không được hiểu là quãng đường đã xác nhận.
- Lớp/nhãn chủ quyền Việt Nam được đặt phía trên lớp tuyến, gồm Hoàng Sa, Trường Sa và Biển Đông.

## 6. Các lỗi đã sửa trong Phase 03

### Frontend

1. Bộ lọc phương thức có giao diện nhưng trước đó không lọc dữ liệu.
2. Tab mặc định mở lịch sử thay vì lô đang vận hành.
3. Lỗi tải logistics chỉ hiện toast và làm trang trống, không có retry rõ ràng.
4. Nút xác nhận chuyển mọi lô chưa kết thúc thẳng sang `delivered`.
5. Shipment mô phỏng vẫn hiện thao tác trạng thái thủ công.
6. Trang logistics chưa có thao tác hủy và chưa khóa mutation theo quyền.
7. Bản đồ/card suy đoán tuyến quốc tế luôn là sea thay vì dùng dữ liệu chặng.
8. Kiểm tra tọa độ bằng truthy làm mất tọa độ bằng 0.
9. Nhãn CO₂e gây cảm giác là số Scope 3 đã được xác nhận; đã đổi thành ước tính vận chuyển.
10. Tracking nuốt lỗi tải và xóa danh sách đang có.
11. Link tracking theo shipment UUID không chọn đúng khi shipment có reference number.
12. Manual shipment không hủy được từ tracking; vị trí suy ra bị ghi như vị trí thật.
13. Trang transport có dialog quyền vị trí không hề gọi quyền trình duyệt nhưng dùng cờ đó để ghi `High confidence`.
14. Role chỉ xem/demo vẫn thấy nút lưu transport có vẻ khả dụng.
15. Rail dùng biểu tượng xe tải.

### Backend

1. Khóa sửa metadata/legs/products sau khi shipment rời `pending`.
2. Thêm kiểm tra optimistic concurrency cho chuyển trạng thái, trả HTTP 409 khi trạng thái đã đổi.
3. Giữ `company_id` ngay trên câu lệnh cập nhật tổng legs/products.
4. Route sửa metadata trả đúng lỗi business 409 thay vì rơi xuống lỗi 500.
5. Trả `primaryTransportMode` trong shipment summary để card và bản đồ dùng dữ liệu thật.
6. Không cộng CO₂e của shipment `cancelled` vào KPI tổng phát thải ước tính.
7. Bổ sung unit test cho lifecycle guard, status conflict, tenant scope và KPI.

## 7. Phần còn lại cần xử lý trước production

### P0

1. Logistics API vẫn nhận `co2e`, `emission_factor_used` và `allocated_co2e` từ client. Trước khi dùng số liệu này cho tuyên bố kiểm toán hoặc báo cáo pháp lý, backend cần tự tính bằng factor registry có phiên bản, lưu provenance và kiểm tra tổng phân bổ theo sản phẩm bằng tổng phát thải chặng.
2. Chạy staging với database/migration thật, tối thiểu hai company và ba role admin/member/viewer; kiểm tra create, transition, conflict, cancel, filter và tenant isolation.
3. Kiểm tra OpenFreeMap, Mapbox token, road routing và nhãn chủ quyền trên trình duyệt thật ở desktop/mobile.

### P1

1. Nếu sản phẩm cần tracking vận tải thật, tích hợp carrier/GPS/webhook. Màn hiện tại chỉ là tracking theo trạng thái và mô phỏng thời gian.
2. Tìm kiếm và lọc thị trường của `/logistics` đang chạy phía client sau khi tải toàn bộ shipment; cần server filter khi dữ liệu lớn.
3. Bổ sung component/E2E test cho các nút status, cancel, permission, retry và map fallback.
4. Chuẩn hóa thông báo business error sang tiếng Việt thay vì hiển thị trực tiếp message tiếng Anh từ API.

### P2

1. Cho phép xem rõ provenance của từng hệ số vận tải ngay ở card/timeline.
2. Thêm phân trang hoặc virtualized list cho tracking khi số shipment lớn.
3. Cho phép người dùng chọn phương thức chính khi shipment có nhiều chặng thay vì luôn dùng chặng đầu trên card.

## 8. Bằng chứng kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| FE ESLint các file Phase 03 | Đạt, 0 error |
| FE TypeScript `tsc --noEmit` | Đạt |
| BE logistics mapper/lifecycle | 2 suite, 13/13 test đạt |
| FE `npm run check` | Đạt; 29 warning tồn tại ngoài thay đổi Phase 03, 0 error |
| FE toàn bộ | 77 file, 282/282 test đạt |
| BE `npm run verify` | Đạt: syntax, OpenAPI, artifact, module boundaries và lint |
| BE toàn bộ | 177 suite, 969/969 test đạt |

Các log lỗi `Only pending shipments...`, `boom` và `db exploded` trong output backend là dữ liệu lỗi giả lập có chủ đích; toàn bộ suite vẫn đạt.

Chưa xác minh trong phase này:

- tương tác trình duyệt và responsive bằng người dùng thật;
- API/database/migration staging;
- Mapbox/OpenFreeMap và route provider từ mạng staging;
- nhiều role và nhiều tenant trên staging;
- carrier telemetry thật;
- production build và deployment.

## 9. Kết luận

Logic vận hành cơ bản của Phase 03 đã hợp lý hơn cho pilot: state machine đúng, dữ liệu terminal bất biến, tenant scope được giữ, bộ lọc dùng backend, lỗi có retry, tracking không giả là GPS và CO₂e được ghi rõ là ước tính. Backend đủ cho luồng đang dùng sau kiểm thử cục bộ.

Phase 03 chưa sẵn sàng cho tuyên bố production có tính pháp lý vì phát thải shipment trực tiếp vẫn do client cung cấp và chưa có bằng chứng staging với hạ tầng bản đồ, database, role và tenant thật.
