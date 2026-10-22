// Chuyển tiếp Range của đúng hai file PMTiles. Bucket chỉ mở CORS cho origin production và localhost,
// nên trang xem trước trên miền Vercel khác không đọc thẳng được. Không nhận URL tự do.
const FILES = {
  gba: 'https://storage.googleapis.com/hue-infra-data-us/gba/buildings.pmtiles',
  cadastre: 'https://storage.googleapis.com/hue-infra-data-us/cadastre/thuadat-2016.pmtiles'
};
const MAX_SPAN = 2000000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const url = FILES[String(req.query.file || '')];
  if (!url) return res.status(400).json({ error: true, message: 'Tệp không được phép' });
  const range = String(req.headers.range || 'bytes=0-16383');
  const m = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (!m) return res.status(400).json({ error: true, message: 'Range không hợp lệ' });
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end < start || end - start > MAX_SPAN) return res.status(400).json({ error: true, message: 'Range quá lớn' });
  try {
    const upstream = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Vary', 'Range');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.status(502).json({ error: true, message: 'Không đọc được tile' });
  }
};
