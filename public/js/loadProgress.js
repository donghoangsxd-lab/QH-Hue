// Phần trăm từng lớp nặng gắn cuối dòng tên trong panel (bậc 0 đỏ → 100 xanh).
// Thanh tiêu đề là một mức chung, vàng, không phụ thuộc nền bản đồ. Câu chờ chỉ hiện lần tải đầu.

const STEP_COLOR = ['#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16', '#16a34a'];
const HIDE_MS = 700;
const FADE_MS = 420;

const ROW = {
  'Ảnh vệ tinh': '#basemapSelect',
  'Nền đường phố': '#basemapSelect',
  'Tem đường': '#chk_roads',
  'Công trình xây dựng': '#chk_gba',
  'Thửa đất địa chính': '#chk_cadastre',
  'Phân bổ dân cư': '#chk_pop',
  'Độ phủ hạ tầng': '#chk_heat',
  'Ranh giới phường xã': '#chk_bound',
  'Mạng lưới đường': '#chk_roads',
  'Đường sắt, đường thủy': '#chk_osmWater',
  'ngập thực tế (Sentinel-1)': '#chk_sarflood',
  'nhiệt độ bề mặt (Landsat)': '#chk_lst',
  'NDVI (Sentinel-2)': '#chk_ndvi',
  'đất xây dựng (vệ tinh)': '#chk_newdev',
  'rừng, phủ thực vật': '#chk_forest'
};

const jobs = new Map();
const badges = new Map();

export function progressColor(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return STEP_COLOR[Math.min(STEP_COLOR.length - 1, Math.floor(n / 20))];
}

const SEEN_KEY = 'qhhue_boot_seen';
const NOTICE_IDLE_MS = 1200;
let bootPct = null;
let bootDone = false;
let dismiss = null;
let noticeTimer = 0;

function alreadySeen() {
  if (dismiss != null) return dismiss;
  try {
    dismiss = localStorage.getItem(SEEN_KEY) === '1'
      || document.documentElement.classList.contains('boot-seen');
  } catch (e) { dismiss = false; }
  return dismiss;
}

/** bootPct < 100 là một phần 100; mỗi việc cộng thêm số phần đang chờ. null khi không còn gì để tải. */
export function combinedProgress(bootValue, parts) {
  let weight = 0;
  let score = 0;
  if (bootValue != null && bootValue < 100) {
    const n = Math.max(0, Math.min(100, Number(bootValue) || 0));
    weight += 100;
    score += n;
  }
  for (const job of parts || []) {
    const pending = Number(job && job.pending) || 0;
    if (pending <= 0) continue;
    const settled = Math.min(pending, (Number(job.done) || 0) + (Number(job.failed) || 0));
    weight += pending;
    score += settled;
  }
  if (!weight) return null;
  return Math.max(0, Math.min(100, Math.round((100 * score) / weight)));
}

function jobsBusy() {
  for (const job of jobs.values()) {
    const pending = job.pending || 0;
    if (pending > 0 && (job.done || 0) + (job.failed || 0) < pending) return true;
  }
  return false;
}

function syncNotice() {
  const el = document.getElementById('mapTitleNotice');
  const root = document.documentElement;
  if (!el) return;
  if (alreadySeen()) {
    el.hidden = true;
    root.classList.remove('show-boot-notice');
    return;
  }
  const busy = !bootDone || jobsBusy();
  if (busy) {
    clearTimeout(noticeTimer);
    noticeTimer = 0;
    el.hidden = false;
    root.classList.add('show-boot-notice');
    return;
  }
  if (noticeTimer) return;
  noticeTimer = setTimeout(() => {
    noticeTimer = 0;
    if (!bootDone || jobsBusy()) return;
    dismiss = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* chế độ riêng tư */ }
    el.hidden = true;
    root.classList.remove('show-boot-notice');
    root.classList.add('boot-seen');
  }, NOTICE_IDLE_MS);
}

/** Mốc nạp ban đầu (lớp phủ, công trình, độ phủ). 100 thì nhường thanh cho các lớp còn lại. */
export function setBootProgress(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (n >= 100) {
    bootPct = null;
    bootDone = true;
  } else {
    bootPct = n;
    bootDone = false;
  }
  paint();
}

function rowOf(name) {
  const sel = ROW[name];
  const anchor = sel && document.querySelector(sel);
  return anchor ? anchor.closest('.layer-row, .basemap-pick') : null;
}

function badgeOf(name, row) {
  let el = badges.get(name);
  if (el && el.isConnected && el.parentElement === row) return el;
  if (el && el.isConnected) el.remove();
  el = document.createElement('b');
  el.className = 'layer-load-pct';
  el.dataset.loadName = name;
  badges.set(name, el);
  const before = row.querySelector(':scope > .layer-slider, :scope > .layer-decisions, :scope > .layer-mini-btn, :scope > select');
  if (before) row.insertBefore(el, before);
  else row.appendChild(el);
  return el;
}

function dropBadge(name) {
  const el = badges.get(name);
  if (!el) return;
  badges.delete(name);
  if (el.isConnected && !el.classList.contains('is-fading')) el.remove();
}

function armHide(name, job) {
  if (job.hideTimer) return;
  job.hideTimer = setTimeout(() => {
    const cur = jobs.get(name);
    if (!cur || cur.hideTimer !== job.hideTimer || cur.done < cur.pending) return;
    const el = badges.get(name);
    if ((cur.watchers || 0) > 0) {
      cur.pending = 0;
      cur.done = 0;
      cur.hideTimer = 0;
    } else {
      jobs.delete(name);
    }
    if (el && el.isConnected) {
      el.classList.add('is-fading');
      setTimeout(() => {
        if (el.isConnected && el.classList.contains('is-fading')) {
          el.remove();
          if (badges.get(name) === el) badges.delete(name);
        }
      }, FADE_MS);
    }
  }, HIDE_MS);
}

function paint() {
  const bar = document.getElementById('titleProgress');
  if (bar) {
    const parts = [];
    jobs.forEach((job) => parts.push(job));
    const pct = combinedProgress(bootPct, parts);
    const fill = bar.querySelector('i');
    if (pct == null) {
      bar.classList.add('done');
      bar.setAttribute('aria-hidden', 'true');
      bar.setAttribute('aria-valuenow', '0');
    } else {
      bar.classList.remove('done');
      bar.removeAttribute('aria-hidden');
      bar.setAttribute('aria-valuenow', String(pct));
      if (fill) fill.style.width = `${pct}%`;
    }
    syncNotice();
  }
  jobs.forEach((job, name) => {
    if (!job.pending) return;
    const row = rowOf(name);
    if (!row) return;
    const failed = job.failed || 0;
    const pct = Math.max(0, Math.min(100, Math.round((100 * Math.min(job.done, job.pending)) / job.pending)));
    const el = badgeOf(name, row);
    if (job.done < job.pending || failed) el.classList.remove('is-fading');
    if (!el.classList.contains('is-fading')) {
      el.style.color = progressColor(pct);
      el.textContent = failed ? `${pct}% · ${failed} lỗi` : `${pct}%`;
      el.title = failed
        ? `${name}: ${job.done}/${job.pending} ô thành công, ${failed} ô lỗi`
        : `${name}: ${pct}%`;
    }
    if (!failed && job.done >= job.pending) armHide(name, job);
    else if (job.hideTimer) {
      clearTimeout(job.hideTimer);
      job.hideTimer = 0;
    }
  });
  badges.forEach((el, name) => {
    if (!jobs.has(name) && !el.classList.contains('is-fading')) dropBadge(name);
  });
}

function slot(name) {
  let job = jobs.get(name);
  if (!job) {
    job = { pending: 0, done: 0, failed: 0, watchers: 0, hideTimer: 0 };
    jobs.set(name, job);
  }
  return job;
}

/** Đếm tileloadstart / tileload. tileerror là ô hỏng, không tính vào phần trăm đã xong. */
export function watchTiles(layer, name) {
  if (!layer || !name || layer._loadProgressName === name) return layer;
  layer._loadProgressName = name;
  const job = slot(name);
  job.watchers += 1;
  layer.on('tileloadstart', () => {
    slot(name).pending += 1;
    paint();
  });
  layer.on('tileload', () => {
    slot(name).done += 1;
    paint();
  });
  layer.on('tileerror', () => {
    const cur = slot(name);
    cur.failed += 1;
    paint();
  });
  layer.on('remove', () => {
    const cur = jobs.get(name);
    if (!cur) return;
    cur.watchers = Math.max(0, cur.watchers - 1);
    if (cur.watchers > 0) return;
    clearTimeout(cur.hideTimer);
    jobs.delete(name);
    dropBadge(name);
    paint();
  });
  return layer;
}

/** Một việc không phải ô ảnh (fetch GEE, file). Gọi hàm trả về khi xong. */
export function trackJob(name) {
  slot(name).pending += 1;
  paint();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const job = jobs.get(name);
    if (!job) return;
    job.done += 1;
    paint();
  };
}

/** Gắn trackJob vào một promise, vẫn trả promise đó. */
export function trackWork(name, promise) {
  const end = trackJob(name);
  return Promise.resolve(promise).then(
    (value) => { end(); return value; },
    (err) => { end(); throw err; }
  );
}
