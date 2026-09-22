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
  if (tbody) tbody.innerHTML = "<tr><td colspan='19' style='text-align:center; padding:20px;'>🔄 Đang tính toán ma trận quy chuẩn từ GEE...</td></tr>";

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

  const initialModalHtml = `<div class="ward-popup-card" style="min-width: 700px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px;">
      <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH HẠ TẦNG QUY CHUẨN: ${wardName.toUpperCase()}</b>
      
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:100px;" class="progress-bar-bg"><div class="progress-bar-fill" id="wardDetailProgressBar" style="width: 5%;"></div></div>
        <span id="wardDetailProgressText" style="font-size:10.5px; font-weight:bold; color:var(--accent-orange);">5%</span>
      </div>
    </div>

    <div style="background:rgba(15, 23, 42, 0.8); border:1px solid var(--border-color); padding:6px; border-radius:6px; margin:6px 0; font-size:11px;">
      👥 Dân số & Đơn vị ở: Đang khởi tạo...
    </div>

    <div id="wardQuotaTableContainer">
      <table class="ward-table">
        <thead>
          <tr>
            <th style="width:30%;">STT / Loại hạ tầng</th>
            <th style="width:25%;">Công trình / Hiện trạng</th>
            <th style="width:12%;">Chỉ tiêu</th>
            <th style="width:18%;">Nhu cầu DT (m²)</th>
            <th style="width:15%;">Đánh giá</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="5" style="text-align:center; padding:25px; color:var(--accent-orange);">⏳ Đang tổng hợp dữ liệu quy chuẩn theo QCVN 01:2026/BXD...</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;

  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 720 })
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

export function selectWardDetail(wardName) {
  closeModal();

  const wardData = state.wardStatsData.find(w => w.Ten_Phuong === wardName);
  if (!wardData) return;

  const firstPoint = state.wardLabelsList.find(w => w.name === wardName) || { lat: 16.4637, lng: 107.5905 };
  if (map) map.flyTo([firstPoint.lat, firstPoint.lng], 14);

  renderWardDetailPopup(wardData);
}

function renderWardDetailPopup(wardData) {
  const popCurrent = wardData.Dan_So_Vector || 45000;
  const popProjected = wardData.projectedPopulation || Math.round(popCurrent * 1.2);
  const currentUnits = wardData.currentUnits || Math.max(1, Math.round(popCurrent / 20000));
  const projectedUnits = wardData.projectedUnits || Math.max(1, Math.round(popProjected / 20000));

  let modalHtml = `<div class="ward-popup-card" style="min-width: 700px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px;">
      <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH QUY CHUẨN QCVN 01:2026/BXD: ${wardData.Ten_Phuong.toUpperCase()}</b>
    </div>
    
    <div style="background:rgba(15, 23, 42, 0.85); border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:8px; font-size:11px; display:flex; justify-content:space-between; align-items:center;">
      <div>👥 Dân số hiện trạng: <b>${popCurrent.toLocaleString()} người</b> (${currentUnits} đơn vị ở)</div>
      <div style="display:flex; align-items:center; gap:6px;">
        📈 Dân số quy hoạch: 
        <input type="number" id="wardPopInput" value="${popProjected}" step="1000" min="1000" style="width:85px; padding:2px 6px; background:#0f172a; color:var(--accent-cyan); border:1px solid var(--border-color); border-radius:4px; font-weight:bold; text-align:center;" /> 
        người (<span id="projectedUnitsLabel">${projectedUnits}</span> đơn vị ở)
      </div>
    </div>

    <div id="wardQuotaTableContainer">
      ${buildWardQuotaTableHtml(wardData, popProjected)}
    </div>
  </div>`;

  const firstPoint = state.wardLabelsList.find(w => w.name === wardData.Ten_Phuong) || { lat: 16.4637, lng: 107.5905 };
  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 720 })
    .setLatLng([firstPoint.lat, firstPoint.lng])
    .setContent(modalHtml);
  
  detailPopup.openOn(map);

  setTimeout(() => {
    window.toggleWardSubItems = function(sectionId) {
      const el = document.getElementById(sectionId);
      const btn = document.getElementById('btn_' + sectionId);
      if (el) {
        if (el.style.display === 'none') {
          el.style.display = 'table-row-group';
          if (btn) btn.textContent = '[-]';
        } else {
          el.style.display = 'none';
          if (btn) btn.textContent = '[+]';
        }
      }
    };

    const popInput = document.getElementById('wardPopInput');
    if (popInput) {
      popInput.onchange = (e) => {
        const newProjPop = Number(e.target.value) || popCurrent;
        const newUnits = Math.max(1, Math.round(newProjPop / 20000));
        const unitLbl = document.getElementById('projectedUnitsLabel');
        if (unitLbl) unitLbl.innerText = newUnits;
        
        wardData.projectedPopulation = newProjPop;
        Object.keys(wardData.urbanResults || {}).forEach(k => {
          wardData.urbanResults[k].requiredArea = wardData.urbanResults[k].quota * newProjPop;
          wardData.urbanResults[k].status = wardData.urbanResults[k].currentArea >= wardData.urbanResults[k].requiredArea;
        });
        Object.keys(wardData.unitResults || {}).forEach(k => {
          wardData.unitResults[k].requiredArea = (wardData.unitResults[k].quota || 0) * newProjPop;
          if (k !== "YT_DV" && k !== "VH_DV" && k !== "TM_DV") {
            wardData.unitResults[k].status = wardData.unitResults[k].currentArea >= wardData.unitResults[k].requiredArea;
          }
        });
        wardData.dvccSummary.requiredArea = 2.0 * newProjPop;

        const container = document.getElementById('wardQuotaTableContainer');
        if (container) {
          container.innerHTML = buildWardQuotaTableHtml(wardData, newProjPop);
        }
      };
    }
  }, 200);
}

function buildWardQuotaTableHtml(wardData, projPop) {
  const urbanRes = wardData.urbanResults || {};
  const unitRes = wardData.unitResults || {};
  const dvccSummary = wardData.dvccSummary || {};

  let html = `<div class="ward-table-scroll-container"><table class="ward-table" style="font-size:10px;">
    <thead>
      <tr>
        <th style="width:30%;">STT / Loại hạ tầng</th>
        <th style="width:25%;">Công trình / Hiện trạng</th>
        <th style="width:12%;">Chỉ tiêu</th>
        <th style="width:18%;">Nhu cầu DT</th>
        <th style="width:15%;">Đánh giá</th>
      </tr>
    </thead>
    <tbody>`;

  // A. CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ
  html += `<tr style="background:rgba(56, 189, 248, 0.18); font-weight:bold;">
    <td colspan="5" style="color:var(--accent-cyan); text-align:left; padding-left:8px;">A / CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ</td>
  </tr>`;

  const urbanKeys = ["THPT", "YT_DT", "VH_DT", "TM_DT", "CV_DT", "BDX_DT"];
  let urbanIdx = 1;

  urbanKeys.forEach(key => {
    const node = urbanRes[key];
    if (!node) return;
    const reqArea = Math.round(node.quota * projPop);
    const isPass = node.currentArea >= reqArea;
    const statusHtml = isPass 
      ? `<span style="color:var(--accent-green); font-weight:bold;">✓ ĐẠT</span>`
      : `<span style="color:var(--accent-red); font-weight:bold;">✗ THIẾU</span>`;

    const sectionId = 'urban_sub_' + key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; margin-left:6px;" title="Thu gọn/Mở rộng">[+]</span>` : '';

    html += `<tr>
      <td style="text-align:left; font-weight:bold;">${urbanIdx}/ ${node.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td style="text-align:center;">>= ${node.quota}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${statusHtml}</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px; background:rgba(255,255,255,0.01);">
          <td style="text-align:left; padding-left:16px; color:var(--accent-cyan);">└ ${sub.name}</td>
          <td style="text-align:right;">${sub.size.toLocaleString()} m²</td>
          <td colspan="3" style="text-align:left;">BK: ${sub.radius}m | ${sub.status ? 'Đã duyệt' : 'Chờ duyệt'}</td>
        </tr>`;
      });
    } else {
      html += `<tr style="color:var(--text-muted); font-size:9.5px; font-style:italic; background:rgba(255,255,255,0.01);">
        <td colspan="5" style="text-align:left; padding-left:16px;">└ Chưa có công trình cập nhật.</td>
      </tr>`;
    }
    html += `</tbody>`;
    urbanIdx++;
  });

  // B. CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở
  html += `<tr style="background:rgba(74, 222, 128, 0.18); font-weight:bold;">
    <td colspan="5" style="color:var(--accent-green); text-align:left; padding-left:8px;">B / CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở</td>
  </tr>`;

  const unitKeys = ["3-MN", "4-TH", "5-THCS"];
  let unitIdx = 1;

  unitKeys.forEach(key => {
    const node = unitRes[key];
    if (!node) return;
    const reqArea = Math.round(node.quota * projPop);
    const isPass = node.currentArea >= reqArea;
    const statusHtml = isPass 
      ? `<span style="color:var(--accent-green); font-weight:bold;">✓ ĐẠT</span>`
      : `<span style="color:var(--accent-red); font-weight:bold;">✗ THIẾU</span>`;

    const sectionId = 'unit_sub_' + key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; margin-left:6px;" title="Thu gọn/Mở rộng">[+]</span>` : '';

    html += `<tr>
      <td style="text-align:left; font-weight:bold;">${unitIdx}/ ${node.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td style="text-align:center;">>= ${node.quota}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${statusHtml}</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px; background:rgba(255,255,255,0.01);">
          <td style="text-align:left; padding-left:16px; color:var(--accent-cyan);">└ ${sub.name}</td>
          <td style="text-align:right;">${sub.size.toLocaleString()} m²</td>
          <td colspan="3" style="text-align:left;">BK: ${sub.radius}m</td>
        </tr>`;
      });
    } else {
      html += `<tr style="color:var(--text-muted); font-size:9.5px; font-style:italic; background:rgba(255,255,255,0.01);">
        <td colspan="5" style="text-align:left; padding-left:16px;">└ Chưa có công trình.</td>
      </tr>`;
    }
    html += `</tbody>`;
    unitIdx++;
  });

  // 4. Dịch vụ công cộng đơn vị ở
  unitIdx = 4;
  const dvccReqArea = Math.round(2.0 * projPop);
  const dvccPass = dvccSummary.status;
  const dvccStatusHtml = dvccPass 
    ? `<span style="color:var(--accent-green); font-weight:bold;">✓ ĐẠT</span>`
    : `<span style="color:var(--accent-red); font-weight:bold;">✗ THIẾU / KHÔNG ĐẠT</span>`;

  html += `<tr>
    <td style="text-align:left; font-weight:bold;">${unitIdx}/ Dịch vụ công cộng đơn vị ở</td>
    <td style="text-align:right; font-weight:bold;">${(dvccSummary.totalArea || 0).toLocaleString()} m²</td>
    <td style="text-align:center;">>= 2.00</td>
    <td style="text-align:right; color:var(--accent-cyan);">${dvccReqArea.toLocaleString()} m²</td>
    <td style="text-align:center;">${dvccStatusHtml}</td>
  </tr>`;

  const subDvcc = [
    { key: "YT_DV", label: "4.1/ Y tế đơn vị ở (>= 500m²/khu)", min: 500 },
    { key: "VH_DV", label: "4.2/ Văn hóa đơn vị ở (>= 1.000m²/khu)", min: 1000 },
    { key: "TM_DV", label: "4.3/ Chợ - TMDV đơn vị ở (>= 2.000m²/khu)", min: 2000 }
  ];

  subDvcc.forEach(subGroup => {
    const node = unitRes[subGroup.key];
    if (!node) return;
    const sectionId = 'dvcc_sub_' + subGroup.key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; margin-left:6px;" title="Thu gọn/Mở rộng">[+]</span>` : '';

    html += `<tr style="background:rgba(255,255,255,0.02);">
      <td style="text-align:left; padding-left:12px; font-weight:600; color:var(--accent-cyan);">${subGroup.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td colspan="2" style="text-align:center; color:var(--text-muted);">Tổng hợp vào DVCC</td>
      <td style="text-align:center;">-</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        const validSize = sub.size >= subGroup.min;
        const evalText = validSize ? '<span style="color:var(--accent-green);">Đạt ĐK tối thiểu</span>' : '<span style="color:var(--accent-red);">Chưa đạt ĐK tối thiểu</span>';
        html += `<tr style="color:var(--text-muted); font-size:9.5px; background:rgba(255,255,255,0.01);">
          <td style="text-align:left; padding-left:22px;">└ ${sub.name}</td>
          <td style="text-align:right;">${sub.size.toLocaleString()} m²</td>
          <td colspan="3" style="text-align:left;">${evalText}</td>
        </tr>`;
      });
    } else {
      html += `<tr style="color:var(--text-muted); font-size:9.5px; font-style:italic; background:rgba(255,255,255,0.01);">
        <td colspan="5" style="text-align:left; padding-left:22px;">└ Chưa có công trình.</td>
      </tr>`;
    }
    html += `</tbody>`;
  });

  // 5. Cây xanh đơn vị ở & 6. Bãi đỗ xe đơn vị ở
  const remainingUnitKeys = ["CV_DV", "BDX_DV"];
  let remIdx = 5;
  remainingUnitKeys.forEach(key => {
    const node = unitRes[key];
    if (!node) return;
    const reqArea = Math.round(node.quota * projPop);
    const isPass = node.currentArea >= reqArea;
    const statusHtml = isPass 
      ? `<span style="color:var(--accent-green); font-weight:bold;">✓ ĐẠT</span>`
      : `<span style="color:var(--accent-red); font-weight:bold;">✗ THIẾU</span>`;

    const sectionId = 'unit_sub_' + key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; margin-left:6px;" title="Thu gọn/Mở rộng">[+]</span>` : '';

    html += `<tr>
      <td style="text-align:left; font-weight:bold;">${remIdx}/ ${node.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td style="text-align:center;">>= ${node.quota}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${statusHtml}</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px; background:rgba(255,255,255,0.01);">
          <td style="text-align:left; padding-left:16px; color:var(--accent-cyan);">└ ${sub.name}</td>
          <td style="text-align:right;">${sub.size.toLocaleString()} m²</td>
          <td colspan="3" style="text-align:left;">BK: ${sub.radius}m</td>
        </tr>`;
      });
    } else {
      html += `<tr style="color:var(--text-muted); font-size:9.5px; font-style:italic; background:rgba(255,255,255,0.01);">
        <td colspan="5" style="text-align:left; padding-left:16px;">└ Chưa có công trình.</td>
      </tr>`;
    }
    html += `</tbody>`;
    remIdx++;
  });

  html += `</tbody></table></div>`;
  return html;
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
