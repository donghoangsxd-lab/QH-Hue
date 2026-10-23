---
name: gishue-download
description: >-
  Tải lớp quy hoạch hoặc thửa đất từ WebGIS gisHue (gServer, geditor.aspx, gissonganh.hue.gov.vn, gis21.hue.gov.vn) ra shapefile.
  Dùng khi người dùng giao task tải dữ liệu, mapid, lớp bản đồ, shapefile, QHPK, QHC, QHCT, hoặc nhắc gisHue / gServer / geditor.
---

# Tải dữ liệu gisHue

Đọc skill này trước khi tải. Không dò lại API, không bấm nút «Xuất shapefile» trên trang (nút đó lỗi). Chỉ đọc REST công khai. Không gọi `addFeature`, `updateFeature`, `deleteFeature`, không vượt đăng nhập.

## File

| File | Vai trò |
|---|---|
| `scripts/gserver-page-fetch.js` | Chạy trong một trang `geditor.aspx` đã mở. Máy nhận phục vụ nó tại `/fetch.js`. |
| `scripts/gserver-to-shp.js` | Máy nhận dump, ghi `.zip` shapefile + `.geojson` + `<tên>-ten-truong.txt`, tự kiểm số đối tượng. |
| `scripts/cadastre-page-fetch.js`, `scripts/cadastre-to-shp.js` | Chỉ thửa đất `tnmt_thuadat` trên gis21. Không lấy `tenchu`. |
| `scripts/build-qhc2045.js` | Dựng JSON webapp từ thư mục đã tải (mapid 21817). Không phải bước tải. |

## Chọn hàm

- Đồ án (ranh, chức năng sử dụng đất, điểm chức năng, hiện trạng nếu có): `qhFetchMany([mapid, …], { postUrl })`. Một trang geditor tải được mọi mapid.
- Chỉ một vai trò: `{ only: ['ranh'] }` hoặc `['vung']`, `['diem']`, `['ht']`.
- Tên lớp không theo mẫu: `{ layers: { vung: ['Sử dụng đất khu A'], ranh: 'Ranh giới lập QH' } }`, hoặc `layersByMap` khi tải nhiều mapid.
- Nguyên nhóm / lớp trên cây (không gán vai trò đồ án): `qhFetchLayers({ mapid, nhom: ['62723'], lop: ['Tên lớp'], postUrl })`. `nhom` nhận mã nhóm hoặc tên nhóm.
- Chưa rõ cây lớp: `await qhListLayers(mapid)` rồi mới tải. Đừng tải cả bản đồ khi chỉ cần vài lớp.

## Luồng nhanh

Một máy nhận, một tab geditor, một `Runtime.evaluate`. Mỗi lệnh shell trên máy này mất khoảng 7 giây chỉ để khởi động; đừng tách bật máy nhận, phục vụ script, tóm tắt, ghi file thành nhiều lệnh.

1. Nếu đã có tab `geditor.aspx` thì dùng lại. Chưa có thì mở đúng một link `https://gissonganh.hue.gov.vn/geditor.aspx?mapid=<một mapid bất kỳ>` và đợi trang có jQuery. Không mở thêm trang cho từng đồ án: danh sách lớp là `GET {URLSERVICEVECTORMAP}/map/{mapid}`.
2. Chọn cổng trống (8765 hay bị server tĩnh chiếm). Bật máy nhận một lần, `block_until_ms: 0`:

```bash
node scripts/gserver-to-shp.js --listen 8796 --auto --out "<thư mục>" --count <số dump>
```

`--count` để tiến trình tự tắt sau đủ số dump. Không `--auto` thì chỉ ghi JSON thô, không ra shapefile.

3. Trong tab đó, một lần `browser_cdp` → `Runtime.evaluate` (`awaitPromise: true`, `returnByValue: true`):

```javascript
eval(await (await fetch('http://127.0.0.1:8796/fetch.js')).text());
await qhFetchMany([22898, 23923], { postUrl: 'http://127.0.0.1:8796/dump' });
```

Lớp nguyên nhóm thì `qhFetchLayers` thay cho `qhFetchMany`. Dump lớn: gán `window.__qhJob` rồi hỏi `window.__qhDone` và `window.__qhProgress`, đừng để một evaluate chờ quá lâu.

4. Đọc JSON máy nhận in ra. `ok: true` và từng lớp `match` (hoặc `n === total`, shapefile `records === geojson`) thì xong. Báo người dùng đường dẫn, số đối tượng, lớp bị bỏ vì không có `geom`.

## Thư mục ra

- Đồ án: `<out>/QH-mapid<id>-<tên đề xuất>/` với `QH-<tên>.zip`, `HT-<tên>.zip` (chỉ khi có hiện trạng), `<tên>-ranh-gioi.zip`, `<tên>-diem-chuc-nang.zip`.
- Nguyên lớp: `<out>/LOP-mapid<id>-<tên>/<nhóm lớp>/<tên lớp>.zip`. Ví dụ đã tải: Desktop `LOP-mapid21817-QHC Đô thị Thừa Thiên Huế`.
- Mỗi zip kèm `.geojson` và `<stem>-ten-truong.txt`. CRS tự nhận (WGS84 / VN-2000), ép bằng `--crs WGS84|HUE_3|UTM48_6`.

Đọc thuộc tính qua file `*-ten-truong.txt`. Không đọc GeoJSON, JSON dump, shapefile vào hội thoại.

## Ràng buộc đã gặp

- Phân trang 20 dòng, tối đa 6 request đồng thời cho mọi lớp, thử lại 4 lần. Tăng đồng thời thì gServer nuốt phản hồi.
- gServer bỏ khóa rỗng trên từng dòng; script thăm trang đầu và trang cuối trước khi xin `fields`.
- Dòng không có hình bị bỏ qua và ghi cảnh báo (lớp Bó vỉa mapid 21817 thiếu 8 dòng).
- Bảng dùng chung nhiều đồ án thì script cắt theo ranh (`scopeDump`). Đọc cảnh báo `scope` trong JSON trả về.
- Thửa đất là luồng riêng: `node scripts/cadastre-to-shp.js --listen 8800 --out "<thư mục>"`, trang gis21 đã mở bằng link có gtoken, rồi `qcStart({ base })`. Chạy lại được: xã đã ghi thì bỏ qua.
