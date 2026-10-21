// Thanh mảnh dưới tiêu đề: đếm ô Leaflet và lượt tải (GEE, PMTiles, GeoJSON) của các lớp đang bật.
// Phần trăm = đã xong / đã yêu cầu. Nhãn là lớp còn nhiều việc nhất.

const jobs = new Map();
let hideTimer = 0;
let labelEl = null;

function bar() {
  return document.getElementById('titleProgress');
}

function label() {
  if (labelEl) return labelEl;
  labelEl = document.createElement('div');
  labelEl.className = 'load-layer-label';
  labelEl.hidden = true;
  document.body.appendChild(labelEl);
  return labelEl;
}

function paint() {
  const el = bar();
  const chip = label();
  let pending = 0;
  let done = 0;
  let name = '';
  let best = 0;
  jobs.forEach((job, key) => {
    pending += job.pending;
    done += Math.min(job.done, job.pending);
    const left = job.pending - job.done;
    if (left > best) {
      best = left;
      name = key;
    }
  });
  if (!pending) {
    chip.hidden = true;
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round((100 * done) / pending)));
  const text = `${name} ${pct}%`;
  if (el) {
    el.classList.remove('done');
    const fill = el.firstElementChild;
    if (fill) fill.style.width = `${pct}%`;
    el.setAttribute('aria-valuenow', String(pct));
    el.setAttribute('aria-valuetext', text);
  }
  chip.hidden = false;
  chip.textContent = text;
  clearTimeout(hideTimer);
  if (done >= pending) {
    hideTimer = setTimeout(() => {
      jobs.clear();
      chip.hidden = true;
      el?.classList.add('done');
    }, 450);
  }
}

function slot(name) {
  let job = jobs.get(name);
  if (!job) {
    job = { pending: 0, done: 0 };
    jobs.set(name, job);
  }
  return job;
}

/** Đếm tileloadstart / tileload / tileerror của một lớp Leaflet. */
export function watchTiles(layer, name) {
  if (!layer || !name || layer._loadProgressName === name) return layer;
  layer._loadProgressName = name;
  layer.on('tileloadstart', () => {
    slot(name).pending += 1;
    paint();
  });
  layer.on('tileload tileerror', () => {
    slot(name).done += 1;
    paint();
  });
  layer.on('remove', () => {
    jobs.delete(name);
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
