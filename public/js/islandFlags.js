// Cờ Việt Nam + nhãn chủ quyền tại quần đảo Hoàng Sa và Trường Sa (luôn hiện trên cả 2 bản đồ, không phụ thuộc lớp bật/tắt)
const ISLANDS = [
  { lat: 16.5, lng: 112.0, name: 'Quần đảo Hoàng Sa' },
  { lat: 10.0, lng: 114.0, name: 'Quần đảo Trường Sa' }
];

// Cờ đỏ sao vàng tỷ lệ 2:3, sao 5 cánh ở tâm cờ
const FLAG_SVG = '<svg class="island-flag-svg" viewBox="0 0 30 20" aria-hidden="true">'
  + '<rect width="30" height="20" fill="#da251d"/>'
  + '<polygon fill="#ffff00" points="15,4 16.35,8.15 20.71,8.15 17.18,10.71 18.53,14.85 15,12.29 11.47,14.85 12.82,10.71 9.29,8.15 13.65,8.15"/>'
  + '</svg>';

export function addIslandFlags(m) {
  if (!m) return;
  ISLANDS.forEach(it => {
    const icon = L.divIcon({
      className: 'island-flag',
      html: `<div class="island-flag-body">${FLAG_SVG}<span class="island-flag-label">`
        + `<b class="island-flag-name">${it.name}</b><span class="island-flag-country">★ Việt Nam ★</span></span></div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    });
    L.marker([it.lat, it.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
  });
}
