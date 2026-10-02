# Phase 02 - Rà soát trang Sản phẩm

## 1. Trạng thái

| Thuộc tính | Giá trị |
|---|---|
| Trang chính | Sản phẩm |
| Route frontend | `/products` |
| Route liên quan | `/summary/[slug]`, `/passport-dashboard`, QR và Digital Product Passport |
| Ngày rà soát | 2026-09-26 |
| Trạng thái rà soát | REVIEWED |
| Trạng thái triển khai sửa | IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING |
| Mức sẵn sàng hiện tại | PARTIAL - phù hợp pilot nội bộ sau khi kiểm thử staging |
| Thay đổi code trong phase | Có - frontend, backend và test |

Phase này kiểm tra danh mục sản phẩm, nhập hàng loạt, quản lý lô, chi tiết sản phẩm, snapshot carbon, QR và passport. Nội dung báo cáo tải xuống vẫn để Phase 19.

## 2. Mục đích thực tế

Trang là điểm bắt đầu vòng đời dữ liệu cấp sản phẩm:

1. Tạo hoặc nhập hàng loạt sản phẩm.
2. Lưu nháp, tính lại và công bố đánh giá sản phẩm.
3. Tìm kiếm, lọc và mở hồ sơ chi tiết.
4. Nhóm sản phẩm vào lô, cập nhật số lượng và công bố lô.
5. Dùng snapshot carbon có phiên bản cho trang chi tiết, QR và passport.
6. Liên kết sản phẩm hoặc lô đã công bố với chuyến hàng khi đủ dữ liệu tuyến.

Thiết kế tổng thể hợp lý cho pilot. Ranh giới quan trọng là số CO2e xem trước ở trình duyệt chỉ phục vụ preview; kết quả được lưu và dùng làm nguồn chính thức phải do backend tính lại và gắn `carbonAuthority`.

## 3. Phạm vi mã nguồn đã kiểm tra

### Frontend

- `app/(dashboard)/products/page.tsx` và demo route tương ứng.
- `components/dashboard/ProductsClient.tsx`.
- `components/dashboard/products/BulkUploadModal.tsx`.
- `components/dashboard/products/BatchManagementModal.tsx`.
- `components/dashboard/products/validation.ts`, `template.ts`, `carbonCalculation.ts`.
- `components/dashboard/SummaryClient.tsx` và các component chi tiết sản phẩm.
- `components/dashboard/ProductQRCode.tsx`.
- `components/dashboard/PassportClient.tsx` và route passport dashboard.
- `lib/productsApi.ts`, cache summary và API logistics liên quan.

### Backend

- `src/modules/products/routes.js`, `validation.js`, `service.js` và các service con.
- `src/modules/assessments/batchesRoutes.js`, `batchesValidators.js`, `batchesService.js`.
- carbon snapshot, authoritative calculation, shipment sync và operational job queue.
- passport service và public claim filtering.
- test products, bulk import, batch, shipment sync, authoritative carbon và passport.

## 4. Luồng dữ liệu và nguồn sự thật

### Danh sách sản phẩm

`GET /api/products` lọc theo company, search, status và phân trang. Frontend chuẩn hóa trạng thái database `active` thành `published` và dùng cache ngắn hạn có invalidation sau mutation.

Sau sửa, ba số liệu tổng quan được lấy bằng truy vấn đếm riêng cho nháp, đã công bố và lô hàng. Chúng không còn được suy ra từ 18 sản phẩm của trang hiện tại. Khi tải lại lỗi, danh sách cũ được giữ lại và giao diện báo rõ dữ liệu có thể chưa mới.

### Carbon

- Preview trong wizard và bulk upload có thể dùng hệ số proxy.
- Khi tạo, cập nhật hoặc công bố, backend bỏ qua tổng carbon do client gửi, tính lại trên server và lưu product assessment snapshot.
- `carbonAuthority` chứa calculation ID/version, engine, methodology, factor registry, GWP basis, hash đầu vào và thời điểm tính.
- Card sản phẩm hiện phân biệt snapshot có phiên bản, dữ liệu proxy và giá trị chưa có snapshot chuẩn.
- Trang summary chặn tải báo cáo khi không có authoritative snapshot và hiển thị nhãn proxy trong phần chi tiết.

### Lô hàng

Batch thuộc company, có trạng thái `draft`, `published`, `archived`. Chỉ draft được sửa metadata hoặc item. Công bố tạo shipment khi tuyến đủ dữ liệu; nếu chưa đủ thì trả lý do bỏ qua thay vì giả lập một shipment hoàn chỉnh.

### Passport và QR

QR chỉ được tạo cho sản phẩm đã công bố. Passport công khai ưu tiên claim đã duyệt và không công khai phép tính nội bộ chưa được chấp nhận. Trang authenticated có thể dùng dữ liệu chi tiết hơn theo quyền hiện hành.

## 5. Kiểm tra chức năng và nút bấm

| Khu vực | Chức năng hoặc nút | Kết quả sau triển khai |
|---|---|---|
| Danh sách | Tìm theo tên hoặc SKU | Hợp lý, debounce 400 ms và truy vấn server |
| Danh sách | Lọc tất cả, nháp, đã xuất bản | Hợp lý, giữ phân trang server |
| Danh sách | Thẻ thống kê | Đã sửa để dùng tổng toàn bộ dữ liệu thay vì đếm trang hiện tại |
| Danh sách | Trang trước/sau | Hợp lý, có chặn biên |
| Danh sách | Mở chi tiết card | Có fallback ID/SKU và cache prefetch; lỗi có thông báo |
| Danh sách | Thêm sản phẩm | Có permission và giới hạn gói Trial |
| Danh sách | Sửa sản phẩm | Có permission; chặn khi shipment liên kết đã hủy |
| Danh sách | Xóa sản phẩm | Có confirm và tenant scope; quyết định xóa vĩnh viễn sản phẩm đã công bố còn phải duyệt |
| Danh sách | Tải file | Có permission, giới hạn Trial và modal import |
| Danh sách | Quản lý lô | Có permission và modal riêng |
| Bulk upload | Tải XLSX/CSV mẫu | FE tạo được cả hai; BE hiện chỉ phục vụ CSV |
| Bulk upload | Parse và kiểm tra cục bộ | Có kiểm tra cấu trúc, kiểu dữ liệu và dữ liệu bắt buộc |
| Bulk upload | Xác thực backend | Đã sửa theo hướng fail closed; API lỗi thì khóa bước nhập |
| Bulk upload | Lỗi từng dòng từ backend | Đã đưa vào danh sách lỗi và loại dòng lỗi khỏi tập được nhập |
| Bulk upload | Preview carbon | Có, nhưng là preview/proxy trước khi backend tính lại |
| Bulk upload | Nhập sản phẩm | Có async job, polling, timeout và kết quả partial success |
| Lô hàng | Danh sách và mở chi tiết | Có loading, lỗi và nút thử lại |
| Lô hàng | Tạo lô | Có; thêm các sản phẩm đã chọn và báo partial failure |
| Lô hàng | Sửa tên/mô tả | Đã nối API cho lô draft |
| Lô hàng | Thêm/xóa item | Có; backend đã khóa với published/archived |
| Lô hàng | Sửa số lượng | Đã nối API và tính lại tổng lô |
| Lô hàng | Lưu trữ | Đã nối soft archive với confirm |
| Lô hàng | Công bố | Có kiểm tra lô rỗng, gói Trial, tài liệu nội địa và chống bấm lặp |
| Summary | Dữ liệu, provenance, version | Có; phân biệt authoritative và proxy |
| QR | Sinh QR | Chỉ cho sản phẩm đã công bố |
| Passport | Claim công khai | Chỉ hiển thị claim đã được duyệt theo service hiện tại |

## 6. Kiểm tra quyền và tenant

- Routes product và batch yêu cầu đăng nhập, role B2B và company context.
- Các truy vấn đọc/ghi chính đều gắn `company_id`.
- Câu lệnh đổi trạng thái sản phẩm đã được bổ sung `company_id` ngay tại `UPDATE`, ngoài bước khóa và kiểm tra trước đó.
- Frontend hiển thị banner chỉ đọc và vô hiệu hóa nút mutation thay vì để người dùng bấm rồi mới nhận 403.
- Modal mutation chỉ được mount khi `canMutate`.

Chưa có test trình duyệt thực tế với nhiều role và hai tenant trên staging, nên kết luận tenant isolation mới dừng ở code và unit/service test.

## 7. Các lỗi đã sửa trong Phase 02

### Frontend

1. Sửa số thống kê nháp/đã công bố/lô hàng bị sai khi dữ liệu có nhiều trang.
2. Giữ dữ liệu đang hiển thị khi refresh lỗi, thêm cảnh báo và nút tải lại.
3. Thêm trạng thái chỉ đọc và khóa rõ các nút tạo, sửa, xóa, upload và quản lý lô.
4. Thêm nhãn nguồn sự thật carbon trên card sản phẩm.
5. Bulk import không còn tiếp tục khi backend validation không khả dụng.
6. Gộp lỗi validation backend vào đúng dòng và không nhập các dòng bị loại.
7. Khóa nút import khi đang xử lý để tránh gửi lặp.
8. Bổ sung sửa metadata lô, sửa số lượng item và lưu trữ lô.
9. Thêm busy guard cho add/remove/update/publish và lỗi tải có retry.

### Backend

1. Chỉ cho phép sửa metadata và item của lô `draft`.
2. Chặn thêm, sửa hoặc xóa item khi lô đã `published` hoặc `archived` bằng HTTP 409 `BATCH_NOT_EDITABLE`.
3. Sửa validator status lô từ giá trị sai `active` sang `published`.
4. Bổ sung company scope trực tiếp vào câu lệnh cập nhật trạng thái sản phẩm.
5. Bổ sung test cho bất biến của lô và tenant scope khi đổi trạng thái.

## 8. Phần còn lại và quyết định cần duyệt

### P0 trước production

1. **Vòng đời xóa sản phẩm:** backend hiện xóa vĩnh viễn sản phẩm và gỡ liên kết batch/shipment. Cần quyết định sản phẩm đã công bố hoặc đã được dùng trong audit/report phải bị cấm xóa hay chuyển sang archive/tombstone. Phase này không tự đổi vì đây là hành vi nghiệp vụ hiện hữu.
2. Chạy test staging bằng ít nhất hai company và các role đọc/ghi, gồm create, publish, batch, QR và public passport.
3. Xác minh migration/schema thật, job queue và shipment sync với database staging.

### P1 cho vận hành thường xuyên

1. Modal lô hiện tải tối đa 100 lô; cần phân trang hoặc infinite scroll khi dữ liệu lớn.
2. Chuẩn hóa template XLSX ở backend hoặc bỏ endpoint XLSX trả 501; hiện FE tự tạo XLSX cục bộ.
3. Thêm test component tương tác cho ProductsClient, BulkUploadModal và BatchManagementModal.
4. Bổ sung hủy hoặc tiếp tục theo job ID khi bulk import vượt timeout thay vì chỉ báo đang xử lý.
5. Hiển thị rõ lý do shipment không được tạo sau publish lô trong UI, không chỉ dựa vào toast/message.

### P2

1. Bộ lọc theo category, market, facility và mức độ đầy đủ dữ liệu.
2. Batch selection/search phía server cho danh mục rất lớn.
3. Workflow phê duyệt/tombstone đầy đủ cho sản phẩm đã phát hành và passport claim.

## 9. Bằng chứng kiểm thử cục bộ

| Cổng kiểm tra | Kết quả |
|---|---|
| FE ESLint các file Phase 02 | Đạt, 0 error |
| FE TypeScript `tsc --noEmit` | Đạt |
| FE `lib/productsApi.test.ts` | 1 file, 3/3 test đạt |
| BE nhóm products/batches/passport | 12 suite, 85/85 test đạt |
| BE `batchesService.test.js` sau bổ sung | 11/11 test đạt |
| FE `npm run check` | Đạt; 29 warning tồn tại ngoài phạm vi Phase 02, 0 error |
| FE toàn bộ | 77 file, 282/282 test đạt |
| BE `npm run verify` | Đạt: syntax, OpenAPI, artifact, module boundaries và lint |
| BE toàn bộ | 176 suite, 963/963 test đạt |

Log `db exploded` xuất hiện trong test shipment sync là dữ liệu lỗi giả lập có chủ đích; suite vẫn đạt.

Chưa xác minh trong phase này:

- trình duyệt thật và responsive interaction;
- API/database staging;
- job worker thật với file lớn;
- QR scan/public passport từ thiết bị bên ngoài;
- production build và deployment.

## 10. Kết luận

| Hạng mục | Kết luận |
|---|---|
| Logic danh mục và phân trang | Hợp lý sau khi sửa thống kê |
| Nguồn sự thật carbon | Tốt ở backend; giao diện đã ghi nhãn rõ hơn |
| Bulk upload | An toàn hơn sau khi bắt buộc backend validation |
| Batch lifecycle | Hợp lý cho pilot sau khi khóa bất biến sau publish |
| QR và passport | Có nền tảng đúng, cần staging/E2E |
| Backend cho chức năng đang dùng | Cơ bản tốt |
| Production readiness | Chưa, do vòng đời xóa sản phẩm và staging chưa được chốt |

Trạng thái Phase 02 là `IMPLEMENTED / VERIFIED LOCALLY / STAGING PENDING`. Phase tiếp theo theo kế hoạch là **Phase 03 - Logistics**.
