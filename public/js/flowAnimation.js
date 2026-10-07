// Chấm sáng chạy dọc tuyến đường ngắn nhất từ rìa vùng phục vụ về công trình (minh họa bán kính tiếp cận theo mạng đường)
// Vẽ trên canvas riêng (pane flowPane) để mỗi khung hình chỉ vẽ lại vài chục chấm, không đụng lớp marker công trình

const PANE = 'flowPane';
const DOTS_PER_PATH = 3;
const SPEED_MPS = 260;     // tốc độ chấm trên bản đồ (m thực địa / giây hiển thị)
const FRAME_MS = 1000 / 30;
// Quầng sáng vẽ bằng nét viền bán trong suốt của chính chấm (thay CSS drop-shadow trên cả canvas)
const DOT_STYLE = { radius: 4.5, weight: 4, color: '#22d3ee', opacity: 0.45, fillColor: '#ffffff', fillOpacity: 1, interactive: false };
const END_STYLE = { radius: 3.5, weight: 2, color: '#22d3ee', fillColor: '#0f172a', fillOpacity: 1, interactive: false };

const renderers = new WeakMap();

function rendererFor(map) {
  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.classList.add('flow-pane');
  }
  if (!renderers.has(map)) renderers.set(map, L.canvas({ pane: PANE }));
  return renderers.get(map);
}

function cumulativeMeters(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + L.latLng(path[i - 1]).distanceTo(path[i]));
  return cum;
}

// d.seg nhớ đoạn đang chạy: s tăng dần nên chỉ dò tiếp từ đoạn cũ, quay vòng thì dò lại từ đầu
function pointAt(d, s) {
  const { path, cum } = d.t;
  let i = d.seg;
  if (i >= cum.length || cum[i - 1] > s) i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  d.seg = i;
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
  const a = path[i - 1], b = path[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * paths: [[lat, lng]...] xếp từ rìa vùng phục vụ về công trình. Trả về hàm dừng (gỡ chấm khỏi group).
 * Luôn chạy (kể cả khi hệ điều hành tắt hiệu ứng động): chấm sáng là phần minh họa chính của vùng phục vụ.
 * Giới hạn 30 khung/giây và tạm dừng khi kéo/zoom bản đồ để không tranh khung hình với các lớp canvas khác.
 */
export function startFlowAnimation(map, group, paths) {
  if (!map || !group || !paths || !paths.length) return () => {};
  const renderer = rendererFor(map);
  const tracks = paths.filter(p => p.length >= 2).map(path => ({ path, cum: cumulativeMeters(path) }));
  const layers = [];
  const add = (layer) => { layers.push(layer); group.addLayer(layer); return layer; };

  tracks.forEach(t => add(L.circleMarker(t.path[0], { ...END_STYLE, renderer })));

  const dots = [];
  tracks.forEach((t, j) => {
    const len = t.cum[t.cum.length - 1];
    for (let k = 0; k < DOTS_PER_PATH; k++) {
      dots.push({ t, len, seg: 1, phase: ((k / DOTS_PER_PATH) + j * 0.137) % 1, marker: add(L.circleMarker(t.path[0], { ...DOT_STYLE, renderer })) });
    }
  });

  let frame = 0;
  let last = 0;
  let paused = false;
  const start = performance.now();
  const tick = (now) => {
    if (!layers.length || !group.hasLayer(layers[0])) return;
    frame = requestAnimationFrame(tick);
    if (paused || now - last < FRAME_MS) return;
    last = now;
    const travelled = ((now - start) / 1000) * SPEED_MPS;
    dots.forEach(d => {
      if (d.len <= 0) return;
      d.marker.setLatLng(pointAt(d, (travelled + d.phase * d.len) % d.len));
    });
  };
  const pause = () => { paused = true; };
  const resume = () => { paused = false; };
  map.on('movestart zoomstart', pause);
  map.on('moveend zoomend', resume);
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    map.off('movestart zoomstart', pause);
    map.off('moveend zoomend', resume);
    layers.forEach(l => group.removeLayer(l));
  };
}
