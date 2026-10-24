// Dân số: cột dan_so («Dân số phường (khống chế)») trong public/data/gba/pop-compare.csv.
// Diện tích: config/constants.js WARD_AREA_KM2 (km² chính thức). Thành phố = tổng 40 đơn vị.
// public/data/ward-boundary.json chỉ có tenXa, không có danSo hay dienTich.
export const DVHC_WARDS = {
  "Phường Thuận An": { pop: 64689, km2: 36.48 },
  "Phường Hóa Châu": { pop: 41328, km2: 34.6 },
  "Phường Mỹ Thượng": { pop: 44736, km2: 28.83 },
  "Phường Vỹ Dạ": { pop: 49684, km2: 8.93 },
  "Phường Thuận Hóa": { pop: 98923, km2: 7.57 },
  "Phường An Cựu": { pop: 55305, km2: 16.71 },
  "Phường Thủy Xuân": { pop: 43373, km2: 37.03 },
  "Phường Kim Long": { pop: 48999, km2: 90.14 },
  "Phường Hương An": { pop: 35885, km2: 19.43 },
  "Phường Phú Xuân": { pop: 130247, km2: 10.38 },
  "Phường Hương Trà": { pop: 33523, km2: 83.28 },
  "Phường Kim Trà": { pop: 36296, km2: 42.8 },
  "Phường Thanh Thủy": { pop: 43569, km2: 48.92 },
  "Phường Hương Thủy": { pop: 29192, km2: 33.93 },
  "Phường Phú Bài": { pop: 38410, km2: 344.63 },
  "Phường Phong Điền": { pop: 27862, km2: 592.48 },
  "Phường Phong Thái": { pop: 37406, km2: 187.02 },
  "Phường Phong Dinh": { pop: 28012, km2: 87.17 },
  "Phường Phong Phú": { pop: 19057, km2: 60.85 },
  "Phường Phong Quảng": { pop: 25728, km2: 41.7 },
  "Xã Đan Điền": { pop: 40389, km2: 82.62 },
  "Xã Quảng Điền": { pop: 41798, km2: 45.93 },
  "Xã Phú Vinh": { pop: 31328, km2: 57.95 },
  "Xã Phú Hồ": { pop: 23550, km2: 57.72 },
  "Xã Phú Vang": { pop: 39250, km2: 86.19 },
  "Xã Vinh Lộc": { pop: 36350, km2: 66.53 },
  "Xã Hưng Lộc": { pop: 32586, km2: 95.62 },
  "Xã Lộc An": { pop: 39217, km2: 177.58 },
  "Xã Phú Lộc": { pop: 50929, km2: 119.3 },
  "Xã Chân Mây - Lăng Cô": { pop: 50831, km2: 261.38 },
  "Xã Long Quảng": { pop: 8883, km2: 215.85 },
  "Xã Nam Đông": { pop: 9158, km2: 175.95 },
  "Xã Khe Tre": { pop: 12882, km2: 256.02 },
  "Xã Bình Điền": { pop: 15229, km2: 266.5 },
  "Xã A Lưới 1": { pop: 12403, km2: 198.59 },
  "Xã A Lưới 2": { pop: 20496, km2: 97.62 },
  "Xã A Lưới 3": { pop: 8976, km2: 154.23 },
  "Xã A Lưới 4": { pop: 10752, km2: 233.65 },
  "Xã A Lưới 5": { pop: 3760, km2: 464.4 },
  "Phường Dương Nỗ": { pop: 31692, km2: 20.63 }
};

const kmSum = Object.values(DVHC_WARDS).reduce((sum, row) => sum + row.km2, 0);
export const DVHC_CITY = {
  name: 'Thành phố Huế',
  pop: 1452683,
  km2: Math.round(kmSum * 100) / 100
};

export function dvhcOf(name) {
  if (name === DVHC_CITY.name) return { pop: DVHC_CITY.pop, km2: DVHC_CITY.km2 };
  return DVHC_WARDS[name] || null;
}
