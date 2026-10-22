// Phần trăm tải của từng lớp nặng, gắn cuối dòng tên trong panel (không gom một nhãn chung).
// Bậc màu: 0 đỏ, 20, 40, 60, 80, 100 xanh. Xong thì giữ một lát rồi mờ.

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
    bar.classList.add('done');
    bar.setAttribute('aria-hidden', 'true');
  }
  jobs.forEach((job, name) => {
    if (!job.pending) return;
    const row = rowOf(name);
    if (!row) return;
    const pct = Math.max(0, Math.min(100, Math.round((100 * Math.min(job.done, job.pending)) / job.pending)));
    const el = badgeOf(name, row);
    if (job.done < job.pending) el.classList.remove('is-fading');
    if (!el.classList.contains('is-fading')) {
      el.style.color = progressColor(pct);
      el.textContent = `${pct}%`;
      el.title = `${name}: ${pct}%`;
    }
    if (job.done >= job.pending) armHide(name, job);
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
    job = { pending: 0, done: 0, watchers: 0, hideTimer: 0 };
    jobs.set(name, job);
  }
  return job;
}

/** Đếm tileloadstart / tileload / tileerror của một lớp Leaflet. */
export function watchTiles(layer, name) {
  if (!layer || !name || layer._loadProgressName === name) return layer;
  layer._loadProgressName = name;
  const job = slot(name);
  job.watchers += 1;
  layer.on('tileloadstart', () => {
    slot(name).pending += 1;
    paint();
  });
  layer.on('tileload tileerror', () => {
    slot(name).done += 1;
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
