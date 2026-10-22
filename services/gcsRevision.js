// Phiên bản nội dung của infrastructure_hue.json là generation trên GCS.
// ?v=generation chỉ đổi khi file bị ghi đè. Không dùng Date.now() (mỗi request một Class B mới).
const RECHECK_MS = 60 * 1000;

function revisionUrl(baseUrl, generation) {
  const gen = String(generation || '').trim();
  const base = String(baseUrl || '');
  if (!gen) return base;
  const url = new URL(base);
  url.searchParams.set('v', gen);
  return url.toString();
}

function needsRevisionCheck(state, now, force) {
  if (force) return true;
  if (!state || !state.generation || !state.checkedAt) return true;
  return now - state.checkedAt >= RECHECK_MS;
}

module.exports = { RECHECK_MS, revisionUrl, needsRevisionCheck };
