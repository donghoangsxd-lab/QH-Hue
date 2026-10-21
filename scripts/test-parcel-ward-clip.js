// Nền thửa khi chọn phường phải theo ranh hiện nay, không theo mã xã cũ.
const assert = require('assert');

(async () => {
  const clip = await import('../public/js/parcelWardClip.js');
  const square = {
    type: 'Polygon',
    coordinates: [[[107.5, 16.4], [107.6, 16.4], [107.6, 16.5], [107.5, 16.5], [107.5, 16.4]]]
  };
  const wards = [
    { name: 'Phường Phú Xuân', geometry: square, maxa: 'OLD' },
    { name: 'Phường Ngoài', geometry: {
      type: 'Polygon',
      coordinates: [[[108.2, 16.2], [108.3, 16.2], [108.3, 16.3], [108.2, 16.3], [108.2, 16.2]]]
    } }
  ];
  assert.strictEqual(clip.wardClipFor('Thành phố Huế', wards), null);
  assert.strictEqual(clip.wardClipFor('', wards), null);
  const phu = clip.wardClipFor('Phường Phú Xuân', wards);
  assert.ok(phu);
  assert.strictEqual(pointIn(clip, 107.55, 16.45, phu), true);
  assert.strictEqual(pointIn(clip, 107.7, 16.45, phu), false);
  assert.strictEqual(pointIn(clip, 108.25, 16.25, phu), false, 'mã xã cũ không kéo thửa phường khác vào');

  const hole = clip.clipFromGeometry({
    type: 'Polygon',
    coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]
    ]
  });
  assert.strictEqual(pointIn(clip, 0.5, 0.5, hole), true);
  assert.strictEqual(pointIn(clip, 1.5, 1.5, hole), false);

  const multi = clip.clipFromGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]]
    ]
  });
  assert.strictEqual(pointIn(clip, 3.5, 3.5, multi), true);
  assert.strictEqual(pointIn(clip, 2, 2, multi), false);

  const insideTile = clip.tileBounds(16, 51820, 28340);
  const far = [109, 17, 109.1, 17.1];
  assert.strictEqual(clip.boundsOverlap(phu.bbox, far), false);
  assert.strictEqual(clip.boundsOverlap(phu.bbox, phu.bbox), true);
  assert.ok(insideTile[2] > insideTile[0] && insideTile[3] > insideTile[1]);

  const [lng, lat] = [107.55, 16.45];
  const z = 16;
  const n = 2 ** z;
  const tx = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const ty = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const local = clip.lngLatToTileLocal(lng, lat, z, tx, ty, 4096);
  const back = clip.tileLocalToLngLat(z, tx, ty, 4096, local[0], local[1]);
  assert.ok(Math.abs(back[0] - lng) < 1e-8 && Math.abs(back[1] - lat) < 1e-8, back.join(','));
  console.log('parcel-ward-clip: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

function pointIn(clip, lng, lat, shape) {
  return clip.pointInClip(lng, lat, shape);
}
