// Phiên chỉnh đỉnh phác thảo. Chỉ tọa độ {lat, lng}, không phụ thuộc Leaflet.
// Đường (line, polyline, arrow) giữ ít nhất 2 đỉnh; đa giác giữ ít nhất 3.
// Mũi tên và vòng tròn dịch được đỉnh định nghĩa; chỉ đường và đa giác có điểm giữa để chèn.

export function isVertexShape(tool) {
  return tool === 'line' || tool === 'polyline' || tool === 'polygon' || tool === 'arrow' || tool === 'circle';
}

export function allowsMidpoints(tool) {
  return tool === 'line' || tool === 'polyline' || tool === 'polygon';
}

export function minVertices(tool) {
  return tool === 'polygon' ? 3 : 2;
}

export function clonePts(pts) {
  return (pts || []).map(p => ({ lat: +p.lat, lng: +p.lng }));
}

export function moveVertex(pts, index, latlng) {
  const next = clonePts(pts);
  if (index < 0 || index >= next.length || !latlng) return next;
  next[index] = { lat: +latlng.lat, lng: +latlng.lng };
  return next;
}

export function insertVertex(pts, index, latlng) {
  const next = clonePts(pts);
  if (!latlng) return next;
  const at = Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, { lat: +latlng.lat, lng: +latlng.lng });
  return next;
}

export function deleteVertex(pts, index, tool) {
  if (!pts || pts.length <= minVertices(tool) || index < 0 || index >= pts.length) {
    return { pts: clonePts(pts), removed: false };
  }
  const next = clonePts(pts);
  next.splice(index, 1);
  return { pts: next, removed: true };
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** index chèn nằm sau đỉnh i. Đa giác thêm cạnh khép về đỉnh đầu. */
export function segmentMidpoints(pts, tool) {
  if (!allowsMidpoints(tool) || !pts || pts.length < 2) return [];
  const closed = tool === 'polygon';
  const n = pts.length;
  const last = closed ? n : n - 1;
  const out = [];
  for (let i = 0; i < last; i++) {
    out.push({ insertAt: i + 1, at: midpoint(pts[i], pts[(i + 1) % n]) });
  }
  return out;
}

export function beginEdit(pts) {
  const original = clonePts(pts);
  return { pts: clonePts(pts), original, active: true };
}

export function dragVertex(session, index, latlng) {
  session.pts = moveVertex(session.pts, index, latlng);
  return session.pts;
}

export function cancelEdit(session) {
  const pts = clonePts(session.original);
  session.pts = pts;
  session.active = false;
  return pts;
}

export function commitEdit(session) {
  session.active = false;
  return clonePts(session.pts);
}

/**
 * Chọn hình → menu → Điều chỉnh → kéo đỉnh / Esc.
 * `savedPts` là hình đang giữ trong phiên (bộ nhớ trang).
 */
export function createSketchEditSession(initialPts, tool) {
  let selected = false;
  let menuOpen = false;
  let editing = false;
  let session = null;
  let saved = clonePts(initialPts);
  return {
    tool,
    select() {
      selected = true;
      return this;
    },
    isSelected() { return selected; },
    openMenu() {
      if (!selected) return [];
      menuOpen = true;
      const items = [];
      if (editing) items.push('Xong');
      else if (isVertexShape(tool)) items.push('Điều chỉnh');
      items.push('Xóa hình này');
      return items;
    },
    isMenuOpen() { return menuOpen; },
    closeMenu() { menuOpen = false; },
    startAdjust() {
      if (!isVertexShape(tool)) return null;
      selected = true;
      menuOpen = false;
      if (!editing) {
        editing = true;
        session = beginEdit(saved);
      }
      return clonePts(session.pts);
    },
    isEditing() { return editing; },
    dragVertex(index, latlng) {
      if (!editing) return clonePts(saved);
      return clonePts(dragVertex(session, index, latlng));
    },
    insertMidpoint(insertAt, latlng) {
      if (!editing || !allowsMidpoints(tool)) return this.workingPts();
      session.pts = insertVertex(session.pts, insertAt, latlng);
      return clonePts(session.pts);
    },
    deleteVertex(index) {
      if (!editing) return { pts: clonePts(saved), removed: false };
      const res = deleteVertex(session.pts, index, tool);
      session.pts = res.pts;
      return { pts: clonePts(res.pts), removed: res.removed };
    },
    vertexMenu() {
      if (!editing) return [];
      return ['Xóa đỉnh', 'Xong'];
    },
    finish() {
      if (!editing) return clonePts(saved);
      saved = commitEdit(session);
      editing = false;
      session = null;
      menuOpen = false;
      return clonePts(saved);
    },
    cancel() {
      if (!editing) return clonePts(saved);
      saved = cancelEdit(session);
      editing = false;
      session = null;
      menuOpen = false;
      return clonePts(saved);
    },
    savedPts() { return clonePts(saved); },
    workingPts() { return clonePts(editing ? session.pts : saved); },
    midpoints() { return segmentMidpoints(this.workingPts(), tool); }
  };
}
