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

export function updateInfraPieChart(sourceList) {
  const widget = document.getElementById('infraPieWidget');
  if (!widget) return;
  widget.style.display = 'block';

  const areaTotals = {};
  let totalAreaSum = 0;

  sourceList.forEach(item => {
    const isApproved = (item.status === true || item.status === 'true' || item.status === 'TRUE');
    if (!isApproved && item.type !== "9-CSD") return;
    const type = item.type || 'Khác';
    const size = Number(item.size || 0);
    areaTotals[type] = (areaTotals[type] || 0) + size;
    totalAreaSum += size;
  });

  const labelsMap = {
    "1-CV": "Công viên, cây xanh",
    "2-BDX": "Bãi đỗ xe, trạm sạc",
    "3-MN": "Trường Mầm non",
    "4-TH": "Trường Tiểu học",
    "5-THCS": "Trường THCS",
    "6-YT": "Cơ sở Y tế",
    "7-VH": "Nhà văn hóa, thể thao",
    "8-TM": "Chợ, TTTM",
    "9-CSD": "Quỹ đất tiềm năng"
  };

  const colorsMap = {
    "1-CV": "#2ecc71",
    "2-BDX": "#3498db",
    "3-MN": "#e67e22",
    "4-TH": "#e74c3c",
    "5-THCS": "#9b59b6",
    "6-YT": "#1abc9c",
    "7-VH": "#f1c40f",
    "8-TM": "#e91e63",
    "9-CSD": "#95a5a6"
  };

  const keys = Object.keys(areaTotals);
  const dataVals = keys.map(k => areaTotals[k]);
  const bgColors = keys.map(k => colorsMap[k] || '#38bdf8');
  const labels = keys.map(k => labelsMap[k] || k);

  const legendContainer = document.getElementById('pieLegendDetails');
  if (legendContainer) {
    let html = '';
    keys.forEach((k, idx) => {
      const val = dataVals[idx];
      const pct = totalAreaSum > 0 ? ((val / totalAreaSum) * 100).toFixed(1) : 0;
      const color = colorsMap[k] || '#38bdf8';
      const name = labelsMap[k] || k;
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
        <span style="color:var(--text-main); display:flex; align-items:center; gap:4px;">
          <span style="width:8px; height:8px; background:${color}; border-radius:50%; display:inline-block;"></span>
          ${name}:
        </span>
        <b style="color:var(--accent-cyan);">${pct}%</b>
      </div>`;
    });
    legendContainer.innerHTML = html || '<div style="text-align:center; color:var(--text-muted);">Chưa có dữ liệu</div>';
  }

  const ctx = document.getElementById('infraPieChart')?.getContext('2d');
  if (!ctx) return;

  if (window.myInfraPieChartInstance) {
    window.myInfraPieChartInstance.destroy();
  }

  const percentageLabelPlugin = {
    id: 'percentageLabelPlugin',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta.hidden) {
          meta.data.forEach((element, index) => {
            const dataVal = dataset.data[index];
            const percentage = totalAreaSum > 0 ? ((dataVal / totalAreaSum) * 100).toFixed(1) : 0;
            
            if (parseFloat(percentage) > 3) {
              const { x, y } = element.tooltipPosition();
              ctx.save();
              ctx.font = 'bold 10px sans-serif';
              ctx.fillStyle = '#ffffff';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
              ctx.shadowBlur = 4;
              ctx.fillText(`${percentage}%`, x, y);
              ctx.restore();
            }
          });
        }
      });
    }
  };

  window.myInfraPieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: bgColors,
        borderWidth: 1,
        borderColor: 'rgba(15, 23, 42, 0.8)'
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
              const val = context.raw || 0;
              const pct = totalAreaSum > 0 ? ((val / totalAreaSum) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${val.toLocaleString()} m² (${pct}%)`;
            }
          }
        }
      },
      cutout: '60%'
    },
    plugins: [percentageLabelPlugin]
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

  const toggleBtn = document.getElementById('btnTogglePieLegend');
  const legendContainer = document.getElementById('pieLegendDetails');
  if (toggleBtn && legendContainer) {
    legendContainer.style.display = 'none';
    toggleBtn.addEventListener('click', () => {
      if (legendContainer.style.display === 'none') {
        legendContainer.style.display = 'block';
        toggleBtn.style.transform = 'rotate(180deg)';
      } else {
        legendContainer.style.display = 'none';
        toggleBtn.style.transform = 'rotate(0deg)';
      }
    });
  }
});

export function openCombinedModal() {
  const combinedModal = document.getElementById('combinedModal');
  if (!combinedModal) return;

  combinedModal.style.display = 'block';
  const tbody = document.getElementById('statTableBody');
  const mBar = document.getElementById('modalProgressBar');
  const mTxt = document.getElementById('modalProgressText');
  
  if (mBar) mBar.style.width = "20%";
  if (mTxt) mTxt.innerText = "20%";
  if (tbody) tbody.innerHTML = "<tr><td colspan='20' style='text-align:center; padding:20px;'>🔄 Đang tính toán ma trận quy chuẩn từ GEE...</td></tr>";

  // Thêm nút xuất PDF vào header modal tổng hợp nếu chưa có
  const headerActions = combinedModal.querySelector('.modal-header > div');
  if (headerActions && !document.getElementById('btnExportCombinedPdf')) {
    const pdfBtn = document.createElement('button');
    pdfBtn.id = 'btnExportCombinedPdf';
    pdfBtn.title = 'Xuất báo cáo PDF';
    pdfBtn.style.cssText = 'background:transparent; border:none; color:var(--accent-cyan); cursor:pointer; font-size:16px; font-weight:bold; margin-right:6px;';
    pdfBtn.innerHTML = '🖨️';
    pdfBtn.onclick = () => {
      const element = document.getElementById('combinedModal');
      html2pdf().from(element).set({
        margin: 10,
        filename: 'Bao-Cao-Ha-Tang-TP-Hue.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      }).save();
    };
    headerActions.insertBefore(pdfBtn, headerActions.firstChild);
  }

  fetch('/api/gee?action=getWardStats')
    .then(r => r.json())
    .then(resData => {
      if (mBar) mBar.style.width = "100%";
      if (mTxt) mTxt.innerText = "100%";
      if (tbody) tbody.innerHTML = "";
      
      state.wardStatsData = resData.data || [];
      const codes = ["1-CV", "2-BDX", "3-MN", "4-TH", "5-THCS", "6-YT", "7-VH", "8-TM"];

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

        row += `<td style="font-weight:bold; color:var(--accent-green); background:rgba(56,189,248,0.05);">${Number(w.Avg_Coverage_Score || 0).toFixed(1)}%</td>`;
        row += `<td style="font-weight:bold; color:var(--accent-orange); background:rgba(245,158,11,0.05);">${Number(w.Avg_Scale_Score || 0).toFixed(1)}%</td></tr>`;
        
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
      if (tbody) tbody.innerHTML = "<tr><td colspan='20' style='text-align:center; color:var(--accent-red); padding:20px;'>❌ Lỗi nạp dữ liệu từ GEE Server.</td></tr>";
    });
}

export function closeModal() { 
  const modal = document.getElementById('combinedModal');
  if (modal) modal.style.display = 'none'; 
}

export async function openWardDetailDirect(wardName) {
  const firstPoint = state.wardLabelsList.find(w => w.name === wardName) || { lat: 16.4637, lng: 107.5905 };
  if (map) map.flyTo([firstPoint.lat, firstPoint.lng], 14);

  const initialModalHtml = `<div class="ward-popup-card" id="wardDetailPdfContainer" style="min-width: 780px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px;">
      <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH HẠ TẦNG QUY CHUẨN: ${wardName.toUpperCase()}</b>
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="btnExportWardPdf" title="Xuất báo cáo PDF" style="background:transparent; border:none; color:var(--accent-cyan); cursor:pointer; font-size:15px; font-weight:bold;">🖨️</button>
        <div style="width:80px;" class="progress-bar-bg"><div class="progress-bar-fill" id="wardDetailProgressBar" style="width: 100%;"></div></div>
      </div>
    </div>
    <div style="background:rgba(15, 23, 42, 0.8); border:1px solid var(--border-color); padding:6px; border-radius:6px; margin:6px 0; font-size:11px;">
      👥 Dân số & Đơn vị ở: Đang khởi tạo...
    </div>
    <div id="wardQuotaTableContainer">
      <table class="ward-table">
        <thead>
          <tr>
            <th style="width:5%; text-align:center;">STT</th>
            <th style="width:31%;">Loại hạ tầng</th>
            <th style="width:12%;">Hiện trạng</th>
            <th style="width:8%;">Chỉ tiêu</th>
            <th style="width:11%;">Nhu cầu DT</th>
            <th style="width:9%; text-align:center;">Số lượng</th>
            <th style="width:12%; text-align:center;">Quy mô</th>
            <th style="width:12%; text-align:center;">Độ phủ</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="8" style="text-align:center; padding:25px; color:var(--accent-orange);">⏳ Đang tổng hợp dữ liệu quy chuẩn theo QCVN 01:2026/BXD...</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;

  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 800 })
    .setLatLng([firstPoint.lat, firstPoint.lng])
    .setContent(initialModalHtml);
  
  detailPopup.openOn(map);

  try {
    const res = await fetch('/api/gee?action=getWardStats');
    const resData = await res.json();
    state.wardStatsData = resData.data || [];
    setTimeout(() => { selectWardDetail(wardName); }, 200);
  } catch (err) {
    console.error("Lỗi tải thống kê hạ tầng phường:", err);
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

  let modalHtml = `<div class="ward-popup-card" id="wardDetailPdfContainer" style="min-width: 780px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px;">
      <b style="font-size:12px; color:var(--accent-cyan);">📍 PHÂN TÍCH QUY CHUẨN QCVN 01:2026/BXD: ${wardData.Ten_Phuong.toUpperCase()}</b>
      <button id="btnExportWardPdf" title="Xuất báo cáo PDF" style="background:transparent; border:none; color:var(--accent-cyan); cursor:pointer; font-size:15px; font-weight:bold;">🖨️</button>
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
  const detailPopup = L.popup({ closeButton: true, autoPan: true, maxWidth: 800 })
    .setLatLng([firstPoint.lat, firstPoint.lng])
    .setContent(modalHtml);
  
  detailPopup.openOn(map);

  setTimeout(() => {
    const pdfBtn = document.getElementById('btnExportWardPdf');
    if (pdfBtn) {
      pdfBtn.onclick = () => {
        const element = document.getElementById('wardDetailPdfContainer');
        html2pdf().from(element).set({
          margin: 10,
          filename: `Bao-Cao-${wardData.Ten_Phuong}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        }).save();
      };
    }

    window.toggleWardSubItems = function(sectionId) {
      const el = document.getElementById(sectionId);
      const btn = document.getElementById('btn_' + sectionId);
      if (el) {
        if (el.style.display === 'none') {
          el.style.display = 'table-row-group';
          if (btn) btn.textContent = '▲';
        } else {
          el.style.display = 'none';
          if (btn) btn.textContent = '▼';
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
  const totalUnits = wardData.projectedUnits || Math.max(1, Math.round(projPop / 20000));

  let html = `<div class="ward-table-scroll-container"><table class="ward-table" style="font-size:9.5px;">
    <thead>
      <tr>
        <th style="width:5%; text-align:center;">STT</th>
        <th style="width:31%;">Loại hạ tầng</th>
        <th style="width:12%;">Hiện trạng</th>
        <th style="width:8%;">Chỉ tiêu</th>
        <th style="width:11%;">Nhu cầu DT</th>
        <th style="width:9%; text-align:center;">Số lượng</th>
        <th style="width:12%; text-align:center;">Quy mô</th>
        <th style="width:12%; text-align:center;">Độ phủ</th>
      </tr>
    </thead>
    <tbody>`;

  // A / CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ (Tách nhóm A vào cột STT)
  html += `<tr style="background:rgba(56, 189, 248, 0.18); font-weight:bold;">
    <td style="text-align:center; color:var(--accent-cyan);">A</td>
    <td colspan="7" style="color:var(--accent-cyan); text-align:left; padding-left:8px;">CÔNG TRÌNH HẠ TẦNG CẤP ĐÔ THỊ</td>
  </tr>`;

  const urbanKeys = ["THPT", "YT_DT", "VH_DT", "TM_DT", "CV_DT", "BDX_DT"];
  let urbanIdx = 1;

  urbanKeys.forEach(key => {
    const node = urbanRes[key];
    if (!node) return;
    const reqArea = Math.round(node.quota * projPop);
    const scalePct = reqArea > 0 ? Math.min(100, Math.round((node.currentArea / reqArea) * 100)) : 100;
    const scaleHtml = `<span style="color:${scalePct >= 100 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">Đạt ${scalePct}%</span>`;
    const countItems = node.subItems ? node.subItems.length : 0;
    const coveragePct = Number(wardData[`Ratio_${key === 'CV_DT' ? '1-CV' : key === 'BDX_DT' ? '2-BDX' : key === 'THPT' ? '4-TH' : key === 'YT_DT' ? '6-YT' : key === 'VH_DT' ? '7-VH' : '8-TM'}`] || scalePct).toFixed(1);
    const coverageHtml = `<span style="color:${coveragePct >= 100 ? 'var(--accent-green)' : 'var(--accent-orange)'}; font-weight:bold;">${coveragePct}%</span>`;

    const sectionId = 'urban_sub_' + key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; float:right; font-size:10px;">▼</span>` : '';

    html += `<tr>
      <td style="text-align:center; font-weight:bold;">${urbanIdx}</td>
      <td style="text-align:left; font-weight:bold;">${node.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td style="text-align:center;">>= ${node.quota}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${countItems} cơ sở</td>
      <td style="text-align:center;">${scaleHtml}</td>
      <td style="text-align:center;">${coverageHtml}</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px;"><td style="text-align:center;">-</td><td colspan="7" style="text-align:left; padding-left:14px;">└ ${sub.name} (${Number(sub.size || 0).toLocaleString()} m²)</td></tr>`;
      });
    }
    html += `</tbody>`;
    urbanIdx++;
  });

  // B / CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (Tách nhóm B vào cột STT)
  html += `<tr style="background:rgba(74, 222, 128, 0.18); font-weight:bold;">
    <td style="text-align:center; color:var(--accent-green);">B</td>
    <td colspan="7" style="color:var(--accent-green); text-align:left; padding-left:8px;">CÔNG TRÌNH HẠ TẦNG CẤP ĐƠN VỊ Ở (Quy hoạch: ${totalUnits} đơn vị ở)</td>
  </tr>`;

  const unitKeys = ["3-MN", "4-TH", "5-THCS"];
  let unitIdx = 1;

  unitKeys.forEach(key => {
    const node = unitRes[key];
    if (!node) return;
    const reqArea = Math.round(node.quota * projPop);
    const countItems = node.subItems ? node.subItems.length : 0;
    const countHtml = `<span style="color:${countItems >= totalUnits ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">${countItems}/${totalUnits}</span>`;
    const scalePct = reqArea > 0 ? Math.min(100, Math.round((node.currentArea / reqArea) * 100)) : 100;
    const scaleHtml = `<span style="color:${scalePct >= 100 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">Đạt ${scalePct}%</span>`;
    const coveragePct = Number(wardData[`Ratio_${key}`] || scalePct).toFixed(1);
    const coverageHtml = `<span style="color:${coveragePct >= 100 ? 'var(--accent-green)' : 'var(--accent-orange)'}; font-weight:bold;">${coveragePct}%</span>`;

    const sectionId = 'unit_sub_' + key;
    const hasSub = node.subItems && node.subItems.length > 0;
    const toggleBtn = hasSub ? `<span id="btn_${sectionId}" onclick="window.toggleWardSubItems('${sectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; float:right; font-size:10px;">▼</span>` : '';

    html += `<tr>
      <td style="text-align:center; font-weight:bold;">${unitIdx}</td>
      <td style="text-align:left; font-weight:bold;">${node.label} ${toggleBtn}</td>
      <td style="text-align:right; font-weight:bold;">${node.currentArea.toLocaleString()} m²</td>
      <td style="text-align:center;">>= ${node.quota}</td>
      <td style="text-align:right; color:var(--accent-cyan);">${reqArea.toLocaleString()} m²</td>
      <td style="text-align:center;">${countHtml}</td>
      <td style="text-align:center;">${scaleHtml}</td>
      <td style="text-align:center;">${coverageHtml}</td>
    </tr>`;

    html += `<tbody id="${sectionId}" style="display:none;">`;
    if (hasSub) {
      node.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px;"><td style="text-align:center;">-</td><td colspan="7" style="text-align:left; padding-left:14px;">└ ${sub.name} (${Number(sub.size || 0).toLocaleString()} m²)</td></tr>`;
      });
    }
    html += `</tbody>`;
    unitIdx++;
  });

  // Dịch vụ công cộng đơn vị ở (Gồm 3 nhóm thành phần Y tế, Văn hóa, Thương mại)
  const dvccSubItems = [...(unitRes["YT_DV"]?.subItems || []), ...(unitRes["VH_DV"]?.subItems || []), ...(unitRes["TM_DV"]?.subItems || [])];
  const dvccTotalArea = (unitRes["YT_DV"]?.currentArea || 0) + (unitRes["VH_DV"]?.currentArea || 0) + (unitRes["TM_DV"]?.currentArea || 0);
  const dvccReqArea = Math.round(2.0 * projPop);
  const dvccScalePct = dvccReqArea > 0 ? Math.min(100, Math.round((dvccTotalArea / dvccReqArea) * 100)) : 100;
  const dvccCountHtml = `<span style="color:${dvccSubItems.length >= totalUnits ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">${dvccSubItems.length}/${totalUnits}</span>`;
  const dvccSectionId = 'unit_sub_DVCC';
  const dvccToggleBtn = `<span id="btn_${dvccSectionId}" onclick="window.toggleWardSubItems('${dvccSectionId}')" style="cursor:pointer; color:var(--accent-cyan); font-weight:bold; float:right; font-size:10px;">▼</span>`;

  html += `<tr>
    <td style="text-align:center; font-weight:bold;">${unitIdx}</td>
    <td style="text-align:left; font-weight:bold;">Dịch vụ công cộng đơn vị ở ${dvccToggleBtn}</td>
    <td style="text-align:right; font-weight:bold;">${dvccTotalArea.toLocaleString()} m²</td>
    <td style="text-align:center;">>= 2.00</td>
    <td style="text-align:right; color:var(--accent-cyan);">${dvccReqArea.toLocaleString()} m²</td>
    <td style="text-align:center;">${dvccCountHtml}</td>
    <td style="text-align:center;"><span style="color:${dvccScalePct >= 100 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:bold;">Đạt ${dvccScalePct}%</span></td>
    <td style="text-align:center; font-weight:bold; color:var(--accent-orange);">${dvccScalePct}%</td>
  </tr>`;

  // Thêm chi tiết 3 nhóm thành phần bên trong Dịch vụ công cộng đơn vị ở
  html += `<tbody id="${dvccSectionId}" style="display:none;">`;
  const subComponentKeys = [
    { key: "YT_DV", label: "✚ Y tế đơn vị ở" },
    { key: "VH_DV", label: "🎭 Văn hóa đơn vị ở" },
    { key: "TM_DV", label: "🛒 Chợ - TMDV đơn vị ở" }
  ];
  subComponentKeys.forEach(comp => {
    const compNode = unitRes[comp.key];
    const compArea = compNode ? compNode.currentArea : 0;
    const compCount = compNode && compNode.subItems ? compNode.subItems.length : 0;
    html += `<tr style="color:var(--accent-cyan); font-size:9.5px; background:rgba(255,255,255,0.02);">
      <td style="text-align:center;">•</td>
      <td style="text-align:left; padding-left:14px; font-weight:bold;">${comp.label}</td>
      <td style="text-align:right;">${compArea.toLocaleString()} m²</td>
      <td colspan="3" style="text-align:left; padding-left:10px;">Số lượng: ${compCount} cơ sở</td>
      <td colspan="2"></td>
    </tr>`;
    if (compNode && compNode.subItems) {
      compNode.subItems.forEach(sub => {
        html += `<tr style="color:var(--text-muted); font-size:9.5px;"><td style="text-align:center;">-</td><td colspan="7" style="text-align:left; padding-left:24px;">└ ${sub.name} (${Number(sub.size || 0).toLocaleString()} m²)</td></tr>`;
      });
    }
  });
  html += `</tbody>`;

  // C / CÁC CƠ SỞ CHƯA SỬ DỤNG (QUỸ ĐẤT TIỀM NĂNG) (Tách nhóm C vào cột STT)
  html += `<tr style="background:rgba(234, 179, 8, 0.18); font-weight:bold;">
    <td style="text-align:center; color:var(--accent-orange);">C</td>
    <td colspan="7" style="color:var(--accent-orange); text-align:left; padding-left:8px;">CÁC CƠ SỞ CHƯA SỬ DỤNG (QUỸ ĐẤT TIỀM NĂNG)</td>
  </tr>`;

  const csdList = wardData.csdItems || [];
  if (csdList.length > 0) {
    csdList.forEach((csd, csdIdx) => {
      let shortProposal = "Quy hoạch hạ tầng công cộng";
      if (csd.suggestions && csd.suggestions.length > 0) {
        const topSugg = csd.suggestions.find(s => s.isTopPriority) || csd.suggestions.find(s => s.status === 'eligible');
        if (topSugg) {
          shortProposal = `Ưu tiên: ${topSugg.label} (Bù đắp ~${topSugg.coverageRatio}% nhu cầu)`;
        }
      }

      html += `<tr style="color:var(--text-main); font-size:9.5px;">
        <td style="text-align:center; font-weight:bold;">${csdIdx + 1}</td>
        <td style="text-align:left; padding-left:6px; font-weight:bold;">${csd.name}</td>
        <td style="text-align:right; font-weight:bold;">${Number(csd.size || 0).toLocaleString()} m²</td>
        <td colspan="4" style="text-align:left; color:var(--accent-orange); font-weight:500;">💡 Đề xuất: ${shortProposal}</td>
        <td style="text-align:center; color:var(--accent-orange);">Chưa sử dụng</td>
      </tr>`;
    });
  } else {
    html += `<tr><td style="text-align:center;">-</td><td colspan="7" style="text-align:center; color:var(--text-muted); font-style:italic;">Không có cơ sở chưa sử dụng nào nằm trong ranh giới phường.</td></tr>`;
  }

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
      datasets: [
        { 
          label: 'Độ phủ (%)', 
          data: state.wardStatsData.map(w => w.Avg_Coverage_Score || 0), 
          backgroundColor: '#38bdf8',
          barPercentage: 0.9,
          categoryPercentage: 0.8
        },
        { 
          label: 'Quy mô (%)', 
          data: state.wardStatsData.map(w => w.Avg_Scale_Score || 0), 
          backgroundColor: '#f59e0b',
          barPercentage: 0.9,
          categoryPercentage: 0.8
        }
      ]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 10 } } } 
      },
      scales: {
        x: { 
          stacked: false, 
          ticks: { font: { size: 8 }, color: '#94a3b8' }, 
          grid: { color: 'rgba(255,255,255,0.05)' } 
        },
        y: { 
          beginAtZero: true, 
          max: 100, 
          ticks: { color: '#94a3b8' }, 
          grid: { color: 'rgba(255,255,255,0.05)' } 
        }
      }
    }
  });
}
