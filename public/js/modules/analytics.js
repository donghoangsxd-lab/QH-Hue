import { geeApiBackend, infraLabels } from '../config.js';
import { map } from './mapManager.js';
import { currentUserRole } from './authManager.js';
import { rawDataList, renderGroupedPoints, refreshHeatmapOnly, globalBufferRadius } from './layerManager.js';

export function onPointClick(p, marker) {
  const isApproved = (p.status === true || p.status === 'true' || p.status === 'TRUE');
  let contentHtml = `<div style="font-size:11px;">`;

  if (!isApproved) {
    contentHtml += `<b style="color:var(--accent-red);">🏢 ${p.name}</b> <span class="badge-pending">DỰ KIẾN</span><br>`;
  } else {
    contentHtml += `<b style="color:var(--accent-cyan);">🏢 ${p.name}</b><br>`;
  }

  contentHtml += `• Loại hạ tầng: <b>${infraLabels[p.type] || p.type}</b><br>`;
  contentHtml += `• Địa bàn: <b>Phường/Xã ${p.ward}</b><br>`;
  contentHtml += `• Diện tích: <b>${p.size.toLocaleString()} m²</b><br>`;

  if (!isApproved) {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-red); font-weight:bold; margin-top:4px;">• Dân số phục vụ DỰ KIẾN: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-red);" id="popValBar"></div></div>
    </div>`;

    if (currentUserRole === "ADMIN") {
      contentHtml += `<button id="btnApprovePoint" data-id="${p.id}" style="width:100%; margin-top:8px; background:var(--accent-green); color:#0f172a; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer;">
        ✅ PHÊ DUYỆT CHÍNH THỨC (ADMIN)
      </button>`;
    } else {
      contentHtml += `<div style="margin-top:6px; font-size:10px; color:var(--accent-orange); font-style:italic; text-align:center;">
        ⏳ Đang chờ Quản trị viên (Admin) phê duyệt.
      </div>`;
    }

    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true })
      .setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    setTimeout(() => {
      const btnApprove = document.getElementById('btnApprovePoint');
      if (btnApprove) {
        btnApprove.onclick = () => approvePointStatus(p.id);
      }
    }, 100);

    let pStep = 0;
    const pInterval = setInterval(() => {
      pStep += 15;
      if (pStep <= 90) {
        const bar = document.getElementById('popValBar');
        const txt = document.getElementById('popValText');
        if (bar) bar.style.width = pStep + "%";
        if (txt) txt.innerText = pStep + "%";
      }
    }, 120);

    fetch(`${geeApiBackend}?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${p.radius}`)
      .then(r => r.json())
      .then(res => {
        clearInterval(pInterval);
        const popVal = res.servedPop || 0;
        const popContainer = document.getElementById('servedPopText');
        if (popContainer) {
          popContainer.innerHTML = `• Dân số phục vụ DỰ KIẾN: ~<b style="color:var(--accent-red);">${popVal.toLocaleString()} người</b>`;
        }
      });

  } else if (p.type !== "9-CSD") {
    contentHtml += `<div id="servedPopText">
      <div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">• Dân số phục vụ CHÍNH THỨC: <span id="popValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" style="background:var(--accent-orange);" id="popValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true })
      .setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    let pStep = 0;
    const pInterval = setInterval(() => {
      pStep += 15;
      if (pStep <= 90) {
        const bar = document.getElementById('popValBar');
        const txt = document.getElementById('popValText');
        if (bar) bar.style.width = pStep + "%";
        if (txt) txt.innerText = pStep + "%";
      }
    }, 120);

    fetch(`${geeApiBackend}?action=analyzePoint&lat=${p.lat}&lng=${p.lng}&radius=${globalBufferRadius}`)
      .then(r => r.json())
      .then(res => {
        clearInterval(pInterval);
        const popVal = res.servedPop || 0;
        const popContainer = document.getElementById('servedPopText');
        if (popContainer) {
          popContainer.innerHTML = `• Dân số phục vụ: ~<b style="color:var(--accent-orange);">${popVal.toLocaleString()} người</b>`;
        }
      });
  } else {
    contentHtml += `<div style="color:var(--accent-orange); font-weight:bold; margin-top:4px;">💡 ĐỀ XUẤT CHUYỂN ĐỔI CÔNG NĂNG:</div>`;
    contentHtml += `<div id="csdSug">
      <div style="font-size:10px; color:var(--text-muted);">⏳ Đang tính toán không gian: <span id="csdValText">0%</span></div>
      <div class="inline-progress-bg"><div class="inline-progress-fill" id="csdValBar"></div></div>
    </div>`;
    contentHtml += `</div>`;

    const popup = L.popup({ closeButton: true, autoPan: true })
      .setLatLng([p.lat, p.lng]).setContent(contentHtml);
    popup.openOn(map);

    let cStep = 0;
    const cInterval = setInterval(() => {
      cStep += 10;
      if (cStep <= 90) {
        const bar = document.getElementById('csdValBar');
        const txt = document.getElementById('csdValText');
        if (bar) bar.style.width = cStep + "%";
        if (txt) txt.innerText = cStep + "%";
      }
    }, 150);

    fetch(`${geeApiBackend}?action=analyzeCSD&lat=${p.lat}&lng=${p.lng}&size=${p.size}&ward=${encodeURIComponent(p.ward)}`)
      .then(r => r.json())
      .then(res => {
        clearInterval(cInterval);
        let sugHtml = "";
        (res.suggestions || []).forEach(s => {
          if (s.isWardDeficit) {
            const priorityBadge = s.isTopPriority ? `<span class="badge-priority">ƯU TIÊN HÀNG ĐẦU</span>` : "";
            const cls = s.isTopPriority ? "sug-card priority" : "sug-card";
            
            sugHtml += `<div class="${cls}">
              <div>🚩 <b>${s.label}</b> ${priorityBadge}</div>
              <div style="color:var(--text-muted); margin-top:2px;">└ Phường thiếu: <b>${s.deficitArea.toLocaleString()} m²</b> | Phục vụ thêm: ~${s.popGained.toLocaleString()} ng</div>
            </div>`;
          } else {
            sugHtml += `<div class="sug-card">
              <div>✓ <b>${s.label}</b></div>
              <div style="color:var(--text-muted); margin-top:2px;">└ Đã đạt chỉ tiêu | Phục vụ thêm: ~${s.popGained.toLocaleString()} ng</div>
            </div>`;
          }
        });
        
        (res.ineligible || []).forEach(inEl => {
          sugHtml += `<div class="sug-card ineligible">❌ <b>${inEl.label}</b> (Không đủ DT min: ${inEl.minSize}m²)</div>`;
        });
        
        const sugContainer = document.getElementById('csdSug');
        if (sugContainer) sugContainer.innerHTML = sugHtml || "<div class='sug-card'>✓ Vị trí đã phủ đủ hạ tầng.</div>";
      });
  }
}

export function approvePointStatus(pointId) {
  if (currentUserRole !== "ADMIN") return;

  const target = rawDataList.find(x => x.id === pointId);
  if (!target) return;

  target.status = true;
  renderGroupedPoints();
  map.closePopup();

  fetch(`${geeApiBackend}?action=approvePoint&id=${encodeURIComponent(pointId)}`)
    .then(r => r.json())
    .then(res => {
      refreshHeatmapOnly();
    });
}

export function submitNewPoint() {
  const type = document.getElementById('newType').value;
  const name = document.getElementById('newName').value;
  const lat = document.getElementById('newLat').value;
  const lng = document.getElementById('newLng').value;
  const ward = document.getElementById('newWard').value || "Thuận Hóa";
  const size = document.getElementById('newSize').value || 0;
  const msg = document.getElementById('statusMsg');

  if (!name || !lat || !lng) {
    msg.style.color = "var(--accent-red)";
    msg.innerText = "⚠️ Vui lòng điền đủ Tên và Tọa độ!";
    return;
  }

  msg.style.color = "var(--accent-orange)";
  msg.innerText = "🚀 Đang gửi đề xuất...";

  const addUrl = `${geeApiBackend}?action=addPoint` +
    `&type=${encodeURIComponent(type)}` +
    `&name=${encodeURIComponent(name)}` +
    `&ward=${encodeURIComponent(ward)}` +
    `&lat=${lat}&lng=${lng}&size=${size}`;

  fetch(addUrl).then(r => r.json()).then(res => {
    msg.style.color = "var(--accent-green)";
    msg.innerText = "✓ Đã lưu đề xuất thành công!";
    
    const newObj = {
      id: "NEW-" + Date.now(),
      name, ward, type,
      lat: Number(lat), lng: Number(lng),
      size: Number(size), radius: 500,
      status: false
    };
    rawDataList.push(newObj);
    renderGroupedPoints();

    setTimeout(() => { 
      document.getElementById('addPointCard').style.display = 'none'; 
    }, 1500);
  }).catch(err => {
    msg.style.color = "var(--accent-red)";
    msg.innerText = "❌ Lỗi kết nối máy chủ!";
  });
}
