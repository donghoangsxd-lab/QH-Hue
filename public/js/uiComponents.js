import { state } from './state.js';
import { map, renderGroupedPoints } from './mapEngine.js';

let chartInstance = null;
let infraPieInstance = null;

export function toggleAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  const msg = document.getElementById('authMsg');
  if (msg) msg.innerText = "";
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

export function handleGoogleCredentialResponse(response) {
  const payload = parseJwt(response.credential);
  const msg = document.getElementById('authMsg');

  if (payload && payload.email) {
    const userEmail = payload.email.toLowerCase();
    
    if (state.adminEmails.includes(userEmail) || userEmail.endsWith("@hue.gov.vn")) {
      state.currentUserRole = "ADMIN";
      if (msg) {
        msg.style.color = "var(--accent-green)";
        msg.innerText = `✓ Xin chào Admin (${payload.name})`;
      }
      
      const btnAuth = document.getElementById('btnAuth');
      if (btnAuth) {
        btnAuth.style.borderColor = "var(--accent-orange)";
        btnAuth.title = `Đã đăng nhập: Admin (${payload.name})`;
        btnAuth.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-orange);">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>`;
      }

      setTimeout(() => {
        toggleAuthModal();
        renderGroupedPoints();
      }, 1000);
    } else {
      if (msg) {
        msg.style.color = "var(--accent-red)";
        msg.innerText = `❌ Email (${userEmail}) không có quyền Quản trị.`;
      }
    }
  } else {
    if (msg) {
      msg.style.color = "var(--accent-red)";
      msg.innerText = "❌ Lỗi xác thực tài khoản Google!";
    }
  }
}

window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;

// ==========================================
// QUẢN LÝ BIỂU ĐỒ TRÒN TỶ TRỌNG DIỆN TÍCH ĐẤT HẠ TẦNG (TRONG SUỐT GÓC TRÊN TRÁI)
// ==========================================
export function updateInfraPieChart(filteredData) {
  const widget = document.getElementById('infraPieWidget');
  if (!widget) return;
  
  widget.style.display = 'block';

  const canvasEl = document.getElementById('infraPieChart');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');

  const typeAreas = {
    "1-CV": 0, "2-BDX": 0, "3-MN": 0, "4-TH": 0, 
    "5-THCS": 0, "6-YT": 0, "7-VH": 0, "8-TM": 0, "9-CSD": 0
  };

  filteredData.forEach(item => {
    const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
    if (isApproved && typeAreas[item.type] !== undefined) {
      typeAreas[item.type] += (Number(item.size) || 0);
    }
  });

  const labels = [
    "Công viên", "Bãi đỗ xe", "Mầm non", "Tiểu học", 
    "THCS", "Y tế", "Văn hóa", "Thương mại", "Đất CSD"
  ];
  const dataValues = Object.values(typeAreas);
  const backgroundColors = [
    '#38bdf8', '#2ecc71', '#f1c40f', '#f39c12', 
    '#e67e22', '#d35400', '#e74c3c', '#900c3f', '#94a3b8'
  ];

  if (infraPieInstance) {
    infraPieInstance.data.datasets[0].data = dataValues;
    infraPieInstance.update();
    return;
  }

  infraPieInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataValues,
        backgroundColor: backgroundColors,
        borderWidth: 1,
        borderColor: 'rgba(15, 23, 42, 0.6)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.label}: ${context.raw.toLocaleString()} m²`;
            }
          }
        }
      }
    }
  });
}

export function hideInfraPieChart() {
  const widget = document.getElementById('infraPieWidget');
  if (widget) widget.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnClosePie')?.addEventListener('click', () => {
    hideInfraPieChart();
  });
});

export function openCombinedModal() {
  const combinedModal = document.getElementById('combinedModal');
  if (!combinedModal) return;

  combinedModal.style.display = 'block';
  const tbody = document.getElementById('statTableBody');
  const mBar = document.getElementById('modalProgressBar');
  const mTxt = document.getElementById('modalProgressText');
  
  if (mBar) mBar.style.width = "0%";
  if (mTxt) mTxt.innerText = "0%";
  if (tbody) tbody.innerHTML = "<tr><td colspan='19' style='text-align:center; padding:20px;'>🔄 Đang tính toán ma trận sống từ GEE...</td></tr>";

  let mStep = 0;
  const mInterval = setInterval(() => {
    mStep += 5;
    if (mStep <= 90) {
      if (mBar) mBar.style.width = mStep + "%";
      if (mTxt) mTxt.innerText = mStep + "%";
    }
  }, 150);

  fetch('/api/gee?action=getWardStats')
    .then(r => r.json())
    .then(resData => {
      clearInterval(mInterval);
      if (mBar) mBar.style.width = "100%";
      if (mTxt) mTxt.innerText = "100%";
      if (tbody) tbody.innerHTML = "";
      
      state.wardStatsData = resData.data || [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH"];

      if (state.wardStatsData.length > 0) {
        renderCombinedChart();
      }

      state.wardStatsData.forEach((w, idx) => {
        let row = `<tr>
          <td>${idx + 1}</td>
          <td style="text-align:left;">
            <a href="javascript:void(0)" class="ward-link" data-ward="${w.Ten_Phuong}" style="font-weight:bold; color:var(--accent-cyan); text-decoration:none;">
              📍 ${w.Ten_Phuong}
            </a>
          </td>
          <td style="font-weight:bold; color:var(--accent-green); text-align:right;">${Number(w.Dan_So_Vector).toLocaleString()}</td>`;

        codes.forEach(c => {
          const cov = Number(w[`Ratio_${c}`] || 0).toFixed(1);
          const scale = Number(w[`Scale_${c}`] || 0).toFixed(1);
          row += `<td style="color:var(--accent-green);">${cov}%</td><td style="color:var(--accent-orange); font-weight:bold;">${scale}%</td>`;
        });

        row += `<td style="color:var(--accent-green);">${Number(w["Ratio_8-TM"] || 0).toFixed(1)}%</td>`;
        row += `<td style="font-weight:bold; color:var(--accent-orange);">${Number(w.Total_Infra_Score || 0).toFixed(1)}%</td></tr>`;
        
        if (tbody) tbody.innerHTML += row;
      });

      document.querySelectorAll('.ward-link').forEach(link => {
        link.onclick = (e) => {
          const wName = e.target.getAttribute('data-ward');
          selectWardDetail(wName);
        };
      });

      renderCombinedChart();
    })
    .catch(() => {
      clearInterval(mInterval);
      if (tbody) tbody.innerHTML = "<tr><td colspan='19' style='text-align:center; color:var(--accent-red); padding:20px;'>❌ Lỗi nạp dữ liệu từ GEE Server.</td></tr>";
    });
}

export function closeModal() { 
  const modal = document.getElementById('combinedModal');
  if (modal) modal.style.display = 'none'; 
}

export async function openWardDetailDirect(wardName) {
  const firstPoint = state.wardLabelsList.find(w => w.name === wardName) || { lat: 16.4637, lng: 107.5905 };
  if (map) map.flyTo([firstPoint.lat, firstPoint.lng], 14);

  const initialModalHtml = `<div class="ward-popup-card" style="min-width: 620px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px;">
      <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH HẠ TẦNG QUY CHUẨN: ${wardName.toUpperCase()}</b>
      
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:100px;" class="progress-bar-bg"><div class="progress-bar-fill" id="wardDetailProgressBar" style="width: 5%;"></div></div>
        <span id="wardDetailProgressText" style="font-size:10.5px; font-weight:bold; color:var(--accent-orange);">5%</span>
      </div>
    </div>

    <div style="background:rgba(15, 23, 42, 0.8); border:1px solid var(--border-color); padding:6px; border-radius:6px; margin:6px 0; font-size:11px;">
      👥 Dân số hiện trạng & Dự báo: Đang khởi tạo...
    </div>

    <div id="wardQuotaTableContainer">
      <table class="ward-table">
        <thead>
          <tr>
            <th style="width:28px;">STT</th>
            <th style="width:160px; text-align:left;">Loại hạ tầng / Công trình</th>
            <th style="width:80px; text-align:right;">Hiện trạng</th>
            <th style="width:55px;">Chỉ tiêu</th>
            <th style="width:85px; text-align:right;">Nhu cầu DT</th>
            <th style="width:125px;">Đánh giá</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="6" style="text-align:center; padding:25px; color:var(--accent-orange);">⏳ Đang tổng hợp dữ liệu không gian và phân tích quy chuẩn (Vui lòng chờ khoảng 10 - 20 giây)...</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;

  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 660 })
    .setLatLng([firstPoint.lat, firstPoint.lng])
    .setContent(initialModalHtml);
  
  detailPopup.openOn(map);

  let pStep = 5;
  const pInterval = setInterval(() => {
    if (pStep < 92) {
      pStep += 2; 
      const bar = document.getElementById('wardDetailProgressBar');
      const txt = document.getElementById('wardDetailProgressText');
      if (bar) bar.style.width = pStep + "%";
      if (txt) txt.innerText = pStep + "%";
    }
  }, 350);

  try {
    const res = await fetch('/api/gee?action=getWardStats');
    const resData = await res.json();
    
    clearInterval(pInterval);
    const bar = document.getElementById('wardDetailProgressBar');
    const txt = document.getElementById('wardDetailProgressText');
    if (bar) bar.style.width = "100%";
    if (txt) txt.innerText = "100%";

    state.wardStatsData = resData.data || [];
    
    setTimeout(() => {
      selectWardDetail(wardName);
    }, 400);

  } catch (err) {
    clearInterval(pInterval);
    console.error("Lỗi tải thống kê hạ tầng phường:", err);
    const container = document.getElementById('wardQuotaTableContainer');
    if (container) {
      container.innerHTML = `<div style="color:var(--accent-red); padding:15px; text-align:center;">❌ Không thể tải dữ liệu quy chuẩn cho ${wardName}. Vui lòng thử lại.</div>`;
    }
  }
}

function getWardInfraList(wardName) {
  if (!wardName || wardName === "Thành phố Huế") {
    return state.rawDataList.filter(item => (item.status === true || item.status === 'true' || item.status === 'TRUE'));
  }
  const wardInfo = state.wardLabelsList.find(w => w.name === wardName);
  if (!wardInfo || !wardInfo.geometry) return [];
  return state.rawDataList.filter(item => {
    const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
    if (!isApproved) return false;
    try {
      const pt = turf.point([item.lng, item.lat]);
      const poly = turf.feature(wardInfo.geometry);
      return turf.booleanPointInPolygon(pt, poly);
    } catch (e) {
      return false;
    }
  });
}

export function selectWardDetail(wardName) {
  closeModal();

  const wardData = state.wardStatsData.find(w => w.Ten_Phuong === wardName);
  if (!wardData) return;

  const wardInfraList = getWardInfraList(wardName);

  const currentAreas = { "1-CV": 0, "2-BDX": 0, "3-MN": 0, "4-TH": 0, "5-THCS": 0, "6-YT": 0, "7-VH": 0, "8-TM": 0 };
  wardInfraList.forEach(item => {
    if (currentAreas[item.type] !== undefined) currentAreas[item.type] += (item.size || 0);
  });

  const currentPop = Number(wardData.Dan_So_Vector || 0);

  let modalHtml = `<div class="ward-popup-card">
    <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH HẠ TẦNG QUY CHUẨN: ${wardName.toUpperCase()}</b><br>
    
    <div style="background:rgba(15, 23, 42, 0.8); border:1px solid var(--border-color); padding:6px; border-radius:6px; margin:6px 0; font-size:11px;">
      👥 Dân số hiện trạng: <b style="color:var(--accent-green);">~${currentPop.toLocaleString()} người</b> | 
      🔮 Dự báo: <input type="number" id="wardPopInput" value="${currentPop}" style="width:75px; font-size:11px; padding:2px; background:#0f172a; border:1px solid var(--border-color); color:#fff; border-radius:4px;">
    </div>

    <div id="wardQuotaTableContainer">
      ${buildWardQuotaTableHtml(wardName, currentPop, currentAreas, wardInfraList)}
    </div>
  </div>`;

  const firstPoint = wardInfraList[0] || { lat: 16.4637, lng: 107.5905 };
  if (map) map.flyTo([firstPoint.lat, firstPoint.lng], 14);

  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 660 })
    .setLatLng([firstPoint.lat, firstPoint.lng])
    .setContent(modalHtml);
  
  setTimeout(() => {
    if (map) detailPopup.openOn(map);
    const popInput = document.getElementById('wardPopInput');
    if (popInput) {
      popInput.onchange = (e) => recalcWardQuota(wardName, e.target.value);
    }
  }, 300);
}

function buildWardQuotaTableHtml(wardName, pop, areas, infraList) {
  const quotaConfig = {
    "1-CV":   { norm: 7.00, label: "Công viên, điểm xanh" },
    "2-BDX":  { norm: 2.50, label: "Bãi đỗ xe" },
    "3-MN":   { norm: 0.60, label: "Mầm non" },
    "4-TH":   { norm: 0.65, label: "Tiểu học" },
    "5-THCS": { norm: 0.55, label: "THCS" },
    "6-YT":   { norm: 0.20, label: "Cơ sở Y tế" },
    "7-VH":   { norm: 1.00, label: "Văn hóa" },
    "8-TM":   { norm: 0.00, label: "Thương mại" }
  };

  let html = `<table class="ward-table">
    <thead>
      <tr>
        <th style="width:28px;">STT</th>
        <th style="width:160px; text-align:left;">Loại hạ tầng / Công trình</th>
        <th style="width:80px; text-align:right;">Hiện trạng</th>
        <th style="width:55px;">Chỉ tiêu</th>
        <th style="width:85px; text-align:right;">Nhu cầu DT</th>
        <th style="width:125px;">Đánh giá</th>
      </tr>
    </thead>
    <tbody>`;

  let stt = 1;
  Object.keys(quotaConfig).forEach(code => {
    const cfg = quotaConfig[code];
    const existArea = areas[code] || 0;
    const actualPerCap = pop > 0 ? (existArea / pop) : 0;
    const reqArea = Math.round(pop * cfg.norm);
    const isPass = actualPerCap >= cfg.norm;
    const diffArea = existArea - reqArea;

    const evalText = cfg.norm === 0 ? "Theo quy hoạch" : (isPass ? `ĐẠT (+${diffArea.toLocaleString()} m²)` : `THIẾU (${diffArea.toLocaleString()} m²)`);
    const evalColor = cfg.norm === 0 ? "var(--text-muted)" : (isPass ? "var(--accent-green)" : "var(--accent-red)");

    html += `<tr style="background:rgba(255,255,255,0.05); font-weight:bold;">
      <td style="text-align:center;">${stt++}</td>
      <td style="text-align:left;">${cfg.label}</td>
      <td style="text-align:right;">${existArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${cfg.norm > 0 ? cfg.norm + ' m²' : '-'}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea > 0 ? reqArea.toLocaleString() + ' m²' : '-'}</td>
      <td style="text-align:center; color:${evalColor}; font-size:9.5px;">${evalText}</td>
    </tr>`;

    const subItems = infraList.filter(it => it.type === code);
    subItems.forEach(item => {
      html += `<tr style="font-size:9.5px; opacity:0.85;">
        <td></td>
        <td style="padding-left:12px; color:var(--accent-cyan);">└ ${item.name}</td>
        <td style="text-align:right;">${item.size.toLocaleString()} m²</td>
        <td style="text-align:center; color:var(--text-muted);">-</td>
        <td style="text-align:right; color:var(--accent-orange);">Bán kính: ${Number(item.radius) || Number(item.banKinh) || 500}m</td>
        <td style="text-align:center; color:var(--accent-green);">✓ Hoạt động</td>
      </tr>`;
    });
  });

  html += `</tbody></table>`;
  return html;
}

function recalcWardQuota(wardName, newPopVal) {
  const popNum = parseInt(newPopVal, 10) || 0;
  const wardData = state.wardStatsData.find(w => w.Ten_Phuong === wardName);
  if (!wardData) return;

  const wardInfraList = getWardInfraList(wardName);

  const currentAreas = { "1-CV": 0, "2-BDX": 0, "3-MN": 0, "4-TH": 0, "5-THCS": 0, "6-YT": 0, "7-VH": 0, "8-TM": 0 };
  wardInfraList.forEach(item => {
    if (currentAreas[item.type] !== undefined) currentAreas[item.type] += (item.size || 0);
  });

  const container = document.getElementById('wardQuotaTableContainer');
  if (container) {
    container.innerHTML = buildWardQuotaTableHtml(wardName, popNum, currentAreas, wardInfraList);
  }
}

function renderCombinedChart() {
  const chartEl = document.getElementById('infraChart');
  if (!chartEl) return;
  const ctx = chartEl.getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: state.wardStatsData.map(w => w.Ten_Phuong.replace('Phường ', '').replace('Xã ', '')),
      datasets: [{ 
        label: 'Điểm Tiếp Cận Hạ Tầng (%)', 
        data: state.wardStatsData.map(w => w.Total_Infra_Score), 
        backgroundColor: '#38bdf8' 
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 8 }, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}
