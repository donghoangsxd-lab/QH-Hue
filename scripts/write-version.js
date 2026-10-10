// Bước build trên Vercel (npm run build): ghi public/version.json = thời điểm deploy theo giờ Việt Nam,
// bảng Giới thiệu tổng quan (public/js/overview.js) đọc để hiện "Ver.dd.mm.yyyy - hh.mm".
const fs = require('fs');
const path = require('path');

const now = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(now).map(p => [p.type, p.value]));

const version = {
  label: `Ver.${parts.day}.${parts.month}.${parts.year} - ${parts.hour}.${parts.minute}`,
  builtAt: now.toISOString(),
  commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
};

const out = path.join(__dirname, '..', 'public', 'version.json');
fs.writeFileSync(out, JSON.stringify(version, null, 2) + '\n');
console.log(`Đã ghi ${path.relative(process.cwd(), out)}: ${version.label}`);
