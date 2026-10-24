// Tô ranh theo điểm. Gỡ lớp cũ trước khi vẽ lại.
import { map, WARD_BOUNDS_EVENT } from './mapEngine.js';
import { state } from './state.js';
import { wardDrawGeometry } from './wardSeam.js';

let group = null;

export { WARD_BOUNDS_EVENT };

function geometryOf(name) {
  return wardDrawGeometry(name) || (state.wardLabelsList || []).find(w => w.name === name)?.geometry || null;
}

export function clearChamDiemMap() {
  if (group) {
    if (map) map.removeLayer(group);
    group.clearLayers();
    group = null;
  }
}

export function paintChamDiemMap(pieces, pick) {
  clearChamDiemMap();
  if (!map || !pieces || !pieces.length) return;
  if (!map.getPane('chamDiemPane')) {
    const pane = map.createPane('chamDiemPane');
    pane.style.zIndex = '436';
  }
  group = L.layerGroup();
  for (const piece of pieces) {
    for (const name of piece.names) {
      const geometry = geometryOf(name);
      if (!geometry) continue;
      const layer = L.geoJSON({ type: 'Feature', geometry }, {
        pane: 'chamDiemPane',
        style: {
          pane: 'chamDiemPane',
          color: piece.stroke,
          weight: 1.8,
          dashArray: piece.dash || null,
          fillColor: piece.fill,
          fillOpacity: 0.72
        },
        onEachFeature: (_f, lyr) => {
          lyr.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            pick(piece.id);
          });
        }
      });
      group.addLayer(layer);
    }
  }
  group.addTo(map);
  if (group.bringToFront) group.bringToFront();
}
