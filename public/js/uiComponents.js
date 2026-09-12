import { state } from './state.js';
import { map, renderGroupedPoints } from './mapEngine.js';

let chartInstance = null;

// ==========================================
// 1. QUẢN LÝ XÁC THỰC GOOGLE OAUTH ADMIN
// ==========================================
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
        btnAuth.style.color = "var(--accent-orange)";
        btnAuth.innerHTML = `🔓 ADMIN (${payload.name})`;
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

// Bind Global cho SDK Google Callback
window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;

// ==========================================
// 2. MODAL BẢNG TỔNG HỢP & CHART 40 PHƯỜNG XÃ
// ==========================================
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

function selectWardDetail(wardName) {
  closeModal();

  const wardData = state.wardStatsData.find(w => w.Ten_Phuong === wardName);
  if (!wardData) return;

  const normWard = wardName.replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '').trim().toLowerCase();
  const wardInfraList = state.rawDataList.filter(item => {
    const itemWardNorm = item.ward.replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '').trim().toLowerCase();
    return itemWardNorm === normWard && (item.status === true || item.status === 'true' || item.status === 'TRUE');
  });

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
        <td style="text-align:right; color:var(--accent-orange);">Bán kính: ${state.globalBufferRadius}m</td>
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

  const normWard = wardName.replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '').trim().toLowerCase();
  const wardInfraList = state.rawDataList.filter(item => {
    const itemWardNorm = item.ward.replace(/^Phường\s+/i, '').replace(/^Xã\s+/i, '').trim().toLowerCase();
    return itemWardNorm === normWard && (item.status === true || item.status === 'true' || item.status === 'TRUE');
  });

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
