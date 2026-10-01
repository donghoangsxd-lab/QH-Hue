// Chấm sáng chạy dọc tuyến đường ngắn nhất từ rìa vùng phục vụ về công trình (minh họa bán kính tiếp cận theo mạng đường)
// Vẽ trên canvas riêng (pane flowPane) để mỗi khung hình chỉ vẽ lại vài chục chấm, không đụng lớp marker công trình

const PANE = 'flowPane';
const DOTS_PER_PATH = 3;
const SPEED_MPS = 260;     // tốc độ chấm trên bản đồ (m thực địa / giây hiển thị)
const DOT_STYLE = { radius: 3.8, stroke: false, fillColor: '#ffffff', fillOpacity: 1, interactive: false };
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

function pointAt(path, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
  const a = path[i - 1], b = path[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * paths: [[lat, lng]...] xếp từ rìa vùng phục vụ về công trình. Trả về hàm dừng (gỡ chấm khỏi group).
 * Luôn chạy (kể cả khi hệ điều hành tắt hiệu ứng động): chấm sáng là phần minh họa chính của vùng phục vụ.
 */
export function startFlowAnimation(map, group, paths) {
  if (!map || !group || !paths || !paths.length) return () => {};
  const renderer = rendererFor(map);
  const tracks = paths.filter(p => p.length >= 2).map(path => ({ path, cum: cumulativeMeters(path) }));
  const layers = [];
  const add = (layer) => { layers.push(layer); group.addLayer(layer); return layer; };

  tracks.forEach(t => add(L.circleMarker(t.path[0], { ...END_STYLE, renderer })));

  let frame = 0;
  const dots = [];
  tracks.forEach((t, j) => {
    const len = t.cum[t.cum.length - 1];
    for (let k = 0; k < DOTS_PER_PATH; k++) {
      dots.push({ t, len, phase: ((k / DOTS_PER_PATH) + j * 0.137) % 1, marker: add(L.circleMarker(t.path[0], { ...DOT_STYLE, renderer })) });
    }
  });
  const start = performance.now();
  const tick = (now) => {
    if (!layers.length || !group.hasLayer(layers[0])) return;
    const travelled = ((now - start) / 1000) * SPEED_MPS;
    dots.forEach(d => {
      if (d.len <= 0) return;
      d.marker.setLatLng(pointAt(d.t.path, d.t.cum, (travelled + d.phase * d.len) % d.len));
    });
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    layers.forEach(l => group.removeLayer(l));
  };
}
