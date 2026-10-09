// Admin sửa ranh 1 lô đất bằng cách kéo đỉnh: đỉnh vàng kéo được (chuột phải: xóa), chấm giữa cạnh kéo / bấm để chèn đỉnh.
// Ranh trả về giữ cấu trúc Polygon / MultiPolygon và các lỗ của ranh gốc.

export const SHAPE_MAX_VERTICES = 600;
const PANE = 'lotShapePane';
const SHAPE_STYLE = { color: '#fde047', weight: 2.5, dashArray: '6 4', fillColor: '#fde047', fillOpacity: 0.18, interactive: false, pane: PANE };

const vertexIcon = () => L.divIcon({ className: 'road-vtx', iconSize: [12, 12], html: '<span style="--c:#fde047"></span>' });
const midIcon = () => L.divIcon({ className: 'road-mid', iconSize: [10, 10], html: '<span></span>' });

// polys: [[vòng ngoài, lỗ...], ...], mỗi vòng là [[lng, lat], ...] không lặp đỉnh cuối
function toPolys(geom) {
  const list = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return list.map(rings => rings.map(ring => {
    const pts = ring.map(c => [Number(c[0]), Number(c[1])]);
    const a = pts[0], b = pts[pts.length - 1];
    if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
    return pts;
  }));
}

function toGeometry(polys) {
  const closed = polys.map(rings => rings.map(ring => [...ring.map(c => [c[0], c[1]]), [ring[0][0], ring[0][1]]]));
  return closed.length === 1 ? { type: 'Polygon', coordinates: closed[0] } : { type: 'MultiPolygon', coordinates: closed };
}

const latLngsOf = (polys) => polys.map(rings => rings.map(ring => ring.map(([lng, lat]) => [lat, lng])));

export function vertexCount(geom) {
  return toPolys(geom).reduce((n, rings) => n + rings.reduce((s, r) => s + r.length, 0), 0);
}

/**
 * Bật chế độ kéo đỉnh trên bản đồ m. onChange(geometry) gọi mỗi lần ranh đổi.
 * Trả về { geometry(), reset(geometry), stop() }
 */
export function startShapeEdit(m, geometry, onChange) {
  if (!m.getPane(PANE)) {
    const pane = m.createPane(PANE);
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
  }
  let polys = toPolys(geometry);
  const layer = L.layerGroup().addTo(m);
  let shape = null;
  // Gỡ marker đang kéo (đóng popup giữa chừng) làm Leaflet phát dragend muộn: sau stop() mọi handler bỏ qua
  let stopped = false;
  const emit = () => { if (!stopped) onChange(toGeometry(polys)); };
  const redrawShape = () => shape && shape.setLatLngs(latLngsOf(polys));

  const render = () => {
    if (stopped) return;
    layer.clearLayers();
    shape = L.polygon(latLngsOf(polys), SHAPE_STYLE).addTo(layer);
    polys.forEach(rings => rings.forEach(ring => {
      ring.forEach((c, i) => {
        const next = ring[(i + 1) % ring.length];
        let added = null;
        L.marker([(c[1] + next[1]) / 2, (c[0] + next[0]) / 2], { icon: midIcon(), draggable: true, keyboard: false, title: 'Kéo hoặc bấm để thêm đỉnh' })
          .on('dragstart', (e) => {
            const p = e.target.getLatLng();
            added = [p.lng, p.lat];
            ring.splice(i + 1, 0, added);
          })
          .on('drag', (e) => {
            const p = e.target.getLatLng();
            added[0] = p.lng;
            added[1] = p.lat;
            redrawShape();
            emit();
          })
          .on('dragend', () => { render(); emit(); })
          .on('click', () => {
            if (added) return;
            ring.splice(i + 1, 0, [(c[0] + next[0]) / 2, (c[1] + next[1]) / 2]);
            render();
            emit();
          })
          .addTo(layer);
      });
      ring.forEach((c, i) => {
        L.marker([c[1], c[0]], {
          icon: vertexIcon(), draggable: true, keyboard: false, zIndexOffset: 500,
          title: `Đỉnh ${i + 1} — kéo để di chuyển, chuột phải để xóa`
        })
          .on('drag', (e) => {
            const p = e.target.getLatLng();
            c[0] = p.lng;
            c[1] = p.lat;
            redrawShape();
            emit();
          })
          .on('dragend', () => { render(); emit(); })
          .on('contextmenu', (e) => {
            L.DomEvent.preventDefault(e.originalEvent);
            if (ring.length <= 3) return;
            ring.splice(i, 1);
            render();
            emit();
          })
          .addTo(layer);
      });
    }));
  };

  render();
  return {
    geometry: () => toGeometry(polys),
    reset(geom) {
      polys = toPolys(geom);
      render();
      emit();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      layer.clearLayers();
      m.removeLayer(layer);
      shape = null;
    }
  };
}
