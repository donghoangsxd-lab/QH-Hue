// Bán kính QCVN cho thí nghiệm dân số. Đọc ứng viên JSON, ghi JSON có radius/group.
// Không đổi logic sản xuất: gọi đúng constants.standardRadius / wardProfile.
const fs = require('fs');
const constants = require('../config/constants');

const src = process.argv[2];
const dest = process.argv[3];
const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = [];
for (const r of rows) {
  const item = {
    id: r.id,
    name: r.name,
    type: r.type,
    nhomHaTang: r.nhom,
    size: r.size,
    lat: r.lat,
    lng: r.lng,
    ward: r.ward,
    status: true
  };
  if (!r.ward) continue;
  const profile = constants.wardProfile(r.ward);
  const radius = constants.standardRadius(item, profile);
  const code = constants.resolveTypeCode(item);
  const thpt = constants.isThptItem(item);
  let group = null;
  if (thpt || code === '3-MN' || code === '4-TH' || code === '5-THCS') group = 'school';
  else if (code === '7-YT') group = 'health';
  else if (code === '1-CV') group = 'park';
  if (!group || !(radius > 0)) continue;
  out.push({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    ward: r.ward,
    radius,
    code: thpt ? 'THPT' : code,
    group,
    profile
  });
}
fs.writeFileSync(dest, JSON.stringify(out));
console.log(out.length);
