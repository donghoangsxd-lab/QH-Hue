const ee = require('@google/earthengine');

let isGeeInitialized = false;

function initGEE() {
  if (isGeeInitialized) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      let privateKey = process.env.GEE_PRIVATE_KEY;
      if (!privateKey) return reject(new Error("Thiếu biến GEE_PRIVATE_KEY"));
      if (typeof privateKey === 'string' && privateKey.trim().startsWith('{')) {
        privateKey = JSON.parse(privateKey);
      } else if (typeof privateKey === 'string') {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      ee.data.authenticateViaPrivateKey(
        privateKey, 
        () => {
          ee.initialize(null, null, () => {
            isGeeInitialized = true;
            resolve();
          }, (err) => reject(new Error("GEE Init Fail: " + err)));
        }, 
        (err) => reject(new Error("GEE Auth Fail: " + err))
      );
    } catch (e) { reject(new Error("Key Parse Fail: " + e.message)); }
  });
}

function getGeeContext() {
  const wardVector = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Polygon-40xa");
  const wardVectorParsed = wardVector.map(f => {
    let rawPop = f.get('danSo');
    if (!rawPop) rawPop = f.get('DanSo');
    const popNum = ee.Algorithms.If(rawPop, ee.Number.parse(ee.String(rawPop)), 0);
    return f.set('danSoNum', popNum);
  });

  const popRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Pixel-danso").select(0).rename('DanSoPixel');
  const wardRegion = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa").select(0).rename('ID_Region');

  const validPopMask = popRaster.gt(0);
  const validPopRaster = popRaster.updateMask(validPopMask);
  const wardPopSumImg = ee.Image().double().paint({ featureCollection: wardVectorParsed, color: 'danSoNum' });

  const statsGrouped = validPopRaster.addBands(wardRegion).reduceRegion({
    reducer: ee.Reducer.count().group({ groupField: 1, groupName: 'ID_Phuong' }),
    geometry: wardVectorParsed.geometry(),
    scale: 60,
    maxPixels: 1e9
  });

  const groupsList = ee.List(statsGrouped.get('groups'));
  const wardPixelCountDict = ee.Dictionary(groupsList.iterate((item, acc) => {
    const d = ee.Dictionary(item);
    const idStr = ee.String(ee.Number(d.get('ID_Phuong')).toInt());
    return ee.Dictionary(acc).set(idStr, d.get('count'));
  }, ee.Dictionary({})));

  const wardPixelCountImg = wardRegion.remap(
    wardPixelCountDict.keys().map(k => ee.Number.parse(k)),
    wardPixelCountDict.values()
  );

  const popRasterNormalized = wardPopSumImg.divide(wardPixelCountImg)
    .updateMask(validPopMask)
    .rename('DanSoPixelNormalized');

  return { ee, wardVectorParsed, popRasterNormalized, wardRegion };
}

module.exports = { initGEE, getGeeContext };
