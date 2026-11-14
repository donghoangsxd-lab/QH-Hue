// Pipeline parse chung cho Đồ án mới / Bổ sung (#hoSoBox) và tái dùng khi batch land/boundary.
// CRS → entities → (boundary | land | network) → optional KH stamp → clip schemeLotClip ở caller.
import { readDrawingFile, tagFeatures, asCollection, DRAW_MAX_BYTES, resolveCrs } from './drawingReaders.js';
import { parseLandStampDxf } from './landStamp.js';
import { clipSchemeLots, SCHEME_EDGE_M, schemeBoundaryOf, clipSentence } from './schemeLotClip.js';

export {
  readDrawingFile, tagFeatures, asCollection, DRAW_MAX_BYTES, resolveCrs,
  clipSchemeLots, SCHEME_EDGE_M, schemeBoundaryOf, clipSentence
};

/** Đọc DXF/KML/KMZ theo drawKind (boundary | land | network). */
export async function ingestSchemeFile(file, drawKind, crsChoice) {
  return readDrawingFile(file, drawKind, crsChoice);
}

/** Đọc file KH (tem đất). */
export async function ingestKhFile(file) {
  if (!file) return { stamps: [], error: 'Thiếu file ký hiệu.' };
  if (!/\.dxf$/i.test(file.name)) return { stamps: [], error: 'File ký hiệu chỉ nhận DXF.' };
  if (file.size > DRAW_MAX_BYTES) return { stamps: [], error: 'File tối đa 20 MB.' };
  try {
    const stamps = parseLandStampDxf(await file.text());
    return { stamps, error: stamps.length ? '' : 'Không đọc được tem trong file.' };
  } catch (err) {
    return { stamps: [], error: err.message || 'Không đọc được file ký hiệu.' };
  }
}

/** Cắt lô theo ranh đồ án (SCHEME_EDGE_M). */
export function clipLandFeatures(features, boundary) {
  return clipSchemeLots(features, boundary);
}
