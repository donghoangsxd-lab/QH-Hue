const ee = require('@google/earthengine');

function initEE() {
  return new Promise((resolve, reject) => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const client_email = credentials.client_email;
    const private_key = (credentials.private_key || "").replace(/\\n/g, '\n').trim();

    ee.data.authenticateViaPrivateKey({ client_email, private_key }, () => {
      ee.initialize(null, null, () => {
        console.log('Earth Engine initialized');
        resolve();
      }, reject);
    }, reject);
  });
}

// ====== Asset gốc ======
const wardsRaster = ee.Image("projects/optimistic-yew-488501-s0/assets/Output40xa");
const wardsFC     = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Hue-BNV-Polygon");
const popRaster   = ee.Image("projects/optimistic-yew-488501-s0/assets/Luu_danso");
const schoolsRaw  = ee.FeatureCollection("projects/optimistic-yew-488501-s0/assets/Mamnon-Hue-2021-loc");

// Tạo geometry Point từ X/Y
const schools = schoolsRaw.map(f => {
  const lon = f.getNumber('X');
  const lat = f.getNumber('Y');
  const geom = ee.Geometry.Point([lon, lat]);
  return ee.Feature(geom, f.toDictionary());
});

// Hàm rasterize buffer
function rasterize(fc) {
  return fc.reduceToImage({
    properties: ['value'],
    reducer: ee.Reducer.anyNonZero()
  }).gt(0);
}

// ====== Các hàm tạo Map ======

// Lớp dân số (mask >0)
function getPopulationMap() {
  const popMask = popRaster.gt(0);
  const densityMasked = popRaster.updateMask(popMask);
  const visParams = {
    min: 0,
    max: 12,
    palette: ["00008b","008000","ffff00","ffa500","ff0000","8b0000"]
  };
  return new Promise((resolve, reject) => {
    densityMasked.getMap(visParams, map => resolve(map.urlFormat), reject);
  });
}

// Lớp buffer 500m toàn TP
function getBuffer500Map() {
  const schoolInner = schools.map(f => f.buffer(500).set('value', 1));
  const schoolInnerMask = rasterize(schoolInner).selfMask();
  return new Promise((resolve, reject) => {
    schoolInnerMask.getMap({palette:['#32CD32'], opacity:0.5}, map => resolve(map.urlFormat), reject);
  });
}

// Lớp buffer 1000m toàn TP
function getBuffer1000Map() {
  const schoolOuter = schools.map(f => f.buffer(1000).set('value', 2));
  const schoolOuterMask = rasterize(schoolOuter).selfMask();
  return new Promise((resolve, reject) => {
    schoolOuterMask.getMap({palette:['#006400'], opacity:0.5}, map => resolve(map.urlFormat), reject);
  });
}

// Lớp ranh giới xã
function getRanhGioiXaMap() {
  const styled = wardsFC.style({color: 'cyan', fillColor:'00000000', width: 2});
  return new Promise((resolve, reject) => {
    styled.getMap({}, map => resolve(map.urlFormat), reject);
  });
}

module.exports = { ee, initEE, getPopulationMap, getBuffer500Map, getBuffer1000Map, getRanhGioiXaMap };
