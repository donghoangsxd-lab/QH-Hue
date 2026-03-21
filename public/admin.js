// Khởi tạo bản đồ Leaflet
var map = L.map('map').setView([16.4637, 107.5909], 13); // Huế

// Thêm tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// Hàm tải dữ liệu từ API /schools
async function loadSchools() {
  const response = await fetch('/schools');
  const schools = await response.json();

  schools.forEach(s => {
  if (!s.lat || !s.lon) return;

  const marker = L.marker([s.lat, s.lon], {
    icon: L.icon({
      iconUrl: s.approve === 'yes'
        ? 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
        : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
      iconSize: [32, 32]
    })
  }).addTo(map);

  marker.bindPopup(`
    <b>${s.tentruong}</b><br>
    Diện tích: ${s.dientich}<br>
    Approve: ${s.approve}<br>
    <button onclick="approveSchool(${s.id})">Approve</button>
  `);
});
}

// Hàm duyệt điểm
async function approveSchool(id) {
  const response = await fetch(`/approve/${id}`, { method: 'POST' });
  const result = await response.json();
  alert("Đã duyệt trường ID " + result.id);
  location.reload(); // tải lại để cập nhật màu marker
}

loadSchools();