var map = L.map('map').setView([16.4637, 107.5909], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// Hiển thị các điểm trường đã có
async function loadSchools() {
  const response = await fetch('/schools');
  const schools = await response.json();

  schools.forEach(s => {
    if (!s.lat || !s.lon) return;

    const color = s.approve === 'yes'
      ? 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
      : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';

    L.marker([s.lat, s.lon], {
      icon: L.icon({ iconUrl: color, iconSize: [32, 32] })
    }).addTo(map)
      .bindPopup(`<b>${s.tentruong}</b><br>Diện tích: ${s.dientich}<br>Approve: ${s.approve}`);
  });
}

// Popup form logic
const openFormBtn = document.getElementById('openFormBtn');
const popupForm = document.getElementById('popupForm');
const pickLonLatBtn = document.getElementById('pickLonLatBtn');
const submitBtn = document.getElementById('submitBtn');

openFormBtn.onclick = () => {
  popupForm.style.display = 'block';
};

// Khi click nút "CHỌN TRÊN BẢN ĐỒ"
let tempMarker = null;

pickLonLatBtn.onclick = () => {
  // Đổi con trỏ chuột thành ghim 📌
  map.getContainer().style.cursor = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\"><text y=\"28\" font-size=\"28\">📌</text></svg>') 12 28, auto";

  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }

  map.once('click', function(e) {
    tempMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: 'custom-pin',
        html: '📌',
        iconSize: [32, 32],
        iconAnchor: [12, 28]
      })
    }).addTo(map);

    document.getElementById('lon').value = e.latlng.lng;
    document.getElementById('lat').value = e.latlng.lat;

    map.getContainer().style.cursor = "";
  });
};

// Khi bấm nút "THÊM"
submitBtn.onclick = async () => {
  const tentruong = document.getElementById('tentruong').value;
  const dientich = document.getElementById('dientich').value;
  const lon = document.getElementById('lon').value;
  const lat = document.getElementById('lat').value;

  const response = await fetch('/addSchool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tentruong, dientich, lon, lat, isAdmin: false })
  });

  const result = await response.json();
  alert("Đã thêm trường mới!");

  L.marker([lat, lon], {
    icon: L.icon({
      iconUrl: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png',
      iconSize: [32, 32]
    })
  }).addTo(map)
    .bindPopup(`<b>${tentruong}</b><br>Diện tích: ${dientich}<br>Approve: ${result.approve}`);

  // Reset form
  document.getElementById('tentruong').value = '';
  document.getElementById('dientich').value = '';
  document.getElementById('lon').value = '';
  document.getElementById('lat').value = '';

  popupForm.style.display = 'none';
};

loadSchools();