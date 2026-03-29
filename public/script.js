// ==========================
// 1. Khởi tạo bản đồ Leaflet
// ==========================
const map = L.map("map").setView([16.4637, 107.5909], 12);

// Nền Google Hybrid
const googleLayer = L.tileLayer("http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}", {
  subdomains: ["mt0", "mt1", "mt2", "mt3"],
  maxZoom: 20,
}).addTo(map);

// ==========================
// 2. Các lớp Earth Engine overlay (qua API backend)
// ==========================
fetch("/api/gee/density")
  .then(res => res.json())
  .then(cfg => L.tileLayer(cfg.url, { attribution: "Google Earth Engine", opacity: 0.4 }).addTo(map));

fetch("/api/gee/buffer500")
  .then(res => res.json())
  .then(cfg => L.tileLayer(cfg.url, { attribution: "Google Earth Engine" }).addTo(map));

fetch("/api/gee/buffer1000")
  .then(res => res.json())
  .then(cfg => L.tileLayer(cfg.url, { attribution: "Google Earth Engine" }).addTo(map));

// ==========================
// 3. Load dữ liệu trường học từ API
// ==========================
fetch("/api/schools")
  .then(res => res.json())
  .then(data => {
    L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const isApproved = (feature.properties.approve === true);
        const iconUrl = isApproved ? "icons/Icon-TH3.png" : "icons/Icon-TH2.png";

        return L.marker(latlng, {
          icon: L.icon({ iconUrl, iconSize: [32, 48], iconAnchor: [16, 48], popupAnchor: [0, -48] }),
        });
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const tinhTrang = props.approve === true ? "Đã cập nhật" : "Đang đề xuất";

        layer.bindPopup(`
          <b>${props.tenDoiTuon || "Không có tên"}</b><br>
          Diện tích: ${props.dienTichDa || "N/A"}<br>
          Phường/Xã: ${props.phuongXaTT || "N/A"}<br>
          Tình trạng: ${tinhTrang}
        `);
      },
    }).addTo(map);
  });

// ==========================
// 4. Form thêm trường mới
// ==========================
const openFormBtn = document.getElementById("openFormBtn");
const popupForm = document.getElementById("popupForm");
const submitBtn = document.getElementById("submitBtn");
const pickLonLatBtn = document.getElementById("pickLonLatBtn");

let tempMarker;
let isPickingCoords = false;

// Mở form
openFormBtn.addEventListener("click", () => {
  popupForm.style.display = "block";
});

// Bật chế độ chọn tọa độ
pickLonLatBtn.addEventListener("click", () => {
  isPickingCoords = true;
  alert("Hãy click vào bản đồ để chọn tọa độ");
});

// Chọn tọa độ trên bản đồ (chỉ khi bật chế độ)
map.on("click", function (e) {
  if (!isPickingCoords) return;

  document.getElementById("lon").value = e.latlng.lng;
  document.getElementById("lat").value = e.latlng.lat;

  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);

  isPickingCoords = false;
});

// Gửi dữ liệu form lên server
submitBtn.addEventListener("click", async () => {
  const tentruong = document.getElementById("tentruong").value;
  const phuongXaTT = document.getElementById("phuongXaTT").value;
  const dientich = document.getElementById("dientich").value;
  const lon = document.getElementById("lon").value;
  const lat = document.getElementById("lat").value;

  const response = await fetch("/api/schools/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tentruong, phuongXaTT, dientich, lon, lat }),
  });

  const result = await response.json();
  alert(result.message || "Đã gửi đề xuất");
  popupForm.style.display = "none";

  // Thêm marker tạm thời màu đỏ (approve = false)
  L.marker([lat, lon], {
    icon: L.icon({
      iconUrl: "icons/Icon-TH2.png",
      iconSize: [32, 48],
      iconAnchor: [16, 48],
      popupAnchor: [0, -48],
    }),
  })
    .addTo(map)
    .bindPopup(
      `<b>${tentruong}</b><br>Diện tích: ${dientich}<br>Phường/Xã: ${phuongXaTT || "Chưa rõ"}<br>Approve: false`
    );
});