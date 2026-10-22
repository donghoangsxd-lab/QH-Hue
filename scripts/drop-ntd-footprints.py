#!/usr/bin/env python3
# Gỡ dấu chân công trình giao thửa địa chính 2016 có mã NTD (kể cả NTD+CLN, CLN+NTD).
# Không lọc diện tích hay chiều cao. Trọng tâm nằm trong thửa hoặc hình giao thửa đều bị gỡ.
# Kho lưu (không nạp vào app): archive/gba/ntd-footprints.jsonl.gz
# PMTiles mới nằm ở public/data/gba/buildings.pmtiles (gitignore). Đẩy bucket khi có quyền:
#   gcloud storage cp public/data/gba/buildings.pmtiles gs://hue-infra-data-us/gba/buildings.pmtiles
# Không chạy lệnh đó ở đây. jsonl gốc được hardlink tại /tmp/gba/buildings.jsonl.before-ntd.

import gzip
import json
import math
import os
import struct
import subprocess
import time
from collections import Counter, defaultdict

import duckdb
from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from shapely.validation import make_valid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
JSONL = os.path.join(TMP, 'buildings.jsonl')
BEFORE = JSONL + '.before-ntd'
PARQUET = os.path.join(TMP, 'bldg_pts.parquet')
CAD = os.path.join(TMP, 'cadastre.jsonl')
LOTS = os.path.join(TMP, 'lots.geojson')
OUT = os.path.join(ROOT, 'public', 'data', 'gba')
PMT = os.path.join(OUT, 'buildings.pmtiles')
AGG = os.path.join(OUT, 'agg.json')
BIN = os.path.join(OUT, 'bldg-hf.bin')
HF = os.path.join(OUT, 'bldg-hf.json')
MASK = os.path.join(OUT, 'cemetery-mask.geojson')
MISSING = os.path.join(OUT, 'bldg-missing.geojson')
OVERRIDES = os.path.join(OUT, 'bldg-overrides.geojson')
ARCHIVE = os.path.join(ROOT, 'archive', 'gba', 'ntd-footprints.jsonl.gz')
REPORT = os.path.join(TMP, 'ntd-delete-report.json')

CELL_M = 150
M_PER_DEG = 111320.0
LAT0 = 16.45
DLAT = CELL_M / M_PER_DEG
DLNG = CELL_M / (M_PER_DEG * math.cos(math.radians(LAT0)))
CELL_AREA = CELL_M * CELL_M
HEIGHT_LIM = 160
N = 65536


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def ntd_token(value):
    buf = ''
    text = str(value or '').upper()
    i = 0
    while i < len(text):
        ch = text[i]
        if 'A' <= ch <= 'Z':
            buf += ch
            if len(buf) == 3:
                if buf == 'NTD':
                    return True
                buf = buf[1:]
        else:
            buf = ''
        i += 1
    return False


def explode(geom):
    geom = make_valid(geom)
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type == 'MultiPolygon':
        return [g for g in geom.geoms if not g.is_empty]
    if geom.geom_type == 'GeometryCollection':
        out = []
        for part in geom.geoms:
            out.extend(explode(part))
        return out
    return []


def load_ntd():
    geoms = []
    codes = Counter()
    with open(CAD, encoding='utf-8') as handle:
        for line in handle:
            if 'NTD' not in line:
                continue
            obj = json.loads(line)
            label = str(obj.get('l') or '')
            if not ntd_token(label):
                continue
            codes[label.upper()] += 1
            geoms.extend(explode(shape(obj['geometry'])))
    log(f'thửa NTD {sum(codes.values())} mảnh {len(geoms)} mã {dict(codes)}')
    return geoms


def connect():
    con = duckdb.connect()
    con.execute('INSTALL spatial')
    con.execute('LOAD spatial')
    con.execute("SET memory_limit='2GB'")
    con.execute('SET threads=2')
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"SET temp_directory='{os.path.join(TMP, 'duck')}'")
    os.makedirs(os.path.join(TMP, 'duck'), exist_ok=True)
    return con


def drop_ids(parcels):
    con = connect()
    con.execute(f"""
        CREATE TABLE pts AS
        SELECT id, cls, area_m2, x, y, coalesce(ward, '') AS ward, coalesce(pop, 0) AS pop,
               ST_Point(x, y) AS pt
        FROM read_parquet('{PARQUET}')
    """)
    con.execute('CREATE TABLE ntd (geom GEOMETRY)')
    pending = []
    for geom in parcels:
        pending.append((geom.wkb,))
        if len(pending) >= 400:
            con.executemany('INSERT INTO ntd VALUES (ST_GeomFromWKB(?))', pending)
            pending.clear()
    if pending:
        con.executemany('INSERT INTO ntd VALUES (ST_GeomFromWKB(?))', pending)
    log('trọng tâm trong thửa')
    hits = [row[0] for row in con.execute("""
        SELECT DISTINCT p.id
        FROM pts p
        JOIN ntd n ON ST_Intersects(n.geom, p.pt)
    """).fetchall()]
    log(f'trọng tâm {len(hits)}')
    log('ứng viên giao mép')
    # Khoảng cách cố định để dùng chỉ mục. 2,5 lần cạnh hình vuông của dấu chân lớn nhất.
    reach = 2.5 * math.sqrt(200000.0) / 100000.0
    cands = [row[0] for row in con.execute("""
        SELECT p.id
        FROM pts p
        ANTI JOIN (SELECT UNNEST(?) AS id) h ON h.id = p.id
        WHERE EXISTS (
            SELECT 1 FROM ntd n
            WHERE ST_DWithin(n.geom, p.pt, ?)
        )
    """, [hits, reach]).fetchall()]
    log(f'ứng viên mép {len(cands)}')
    extra = []
    if cands:
        tree = STRtree(parcels)
        want = set(cands)
        with open(JSONL, encoding='utf-8') as handle:
            for index, line in enumerate(handle, 1):
                if index not in want:
                    continue
                geom = shape(json.loads(line)['geometry'])
                if not geom.is_valid:
                    geom = make_valid(geom)
                found = tree.query(geom, predicate='intersects')
                if len(found):
                    extra.append(index)
                want.remove(index)
                if not want:
                    break
        if want:
            raise SystemExit(f'thiếu dòng jsonl cho {len(want)} ứng viên')
    log(f'giao mép thêm {len(extra)}')
    dropped = set(hits)
    dropped.update(extra)
    rows = con.execute("""
        SELECT id, cls, area_m2, x, y, ward, pop
        FROM pts
        WHERE id IN (SELECT UNNEST(?))
    """, [list(dropped)]).fetchall()
    con.close()
    return dropped, rows


def to_px(lng, lat):
    xf = ((lng + 180.0) / 360.0) * N
    s = math.sin(math.radians(lat))
    yf = (1.0 - math.log((1.0 + s) / (1.0 - s)) / (2.0 * math.pi)) * N / 2.0
    x = math.floor(xf)
    y = math.floor(yf)
    gx = x * 4096 + math.floor((xf - x) * 4096)
    gy = y * 4096 + math.floor((yf - y) * 4096)
    return int(gx), int(gy)


class Heights:
    def __init__(self, path):
        with open(path, 'rb') as handle:
            data = handle.read()
        if data[:4] != b'GBH2':
            raise SystemExit('bldg-hf sai magic')
        self.tiles_n = struct.unpack_from('<I', data, 4)[0]
        self.count = struct.unpack_from('<I', data, 8)[0]
        self.tiles = []
        pos = 12
        for _ in range(self.tiles_n):
            key, start, count = struct.unpack_from('<III', data, pos)
            self.tiles.append([key, start, count])
            pos += 12
        self.rec0 = pos
        self.samples = []
        self.cells = defaultdict(list)
        flat = 0
        for ti, (key, start, count) in enumerate(self.tiles):
            tx = key >> 16
            ty = key & 0xFFFF
            base = self.rec0 + start * 8
            for ri in range(count):
                px, py, h2, pad = struct.unpack_from('<HHHH', data, base + ri * 8)
                gx = tx * 4096 + px
                gy = ty * 4096 + py
                self.samples.append((gx, gy, px, py, h2, pad, ti, ri))
                self.cells[(gx // 128, gy // 128)].append(flat)
                flat += 1
        if flat != self.count:
            raise SystemExit(f'số mẫu chiều cao {flat} khác header {self.count}')

    def nearest(self, lng, lat):
        gx, gy = to_px(lng, lat)
        best = None
        best_d = HEIGHT_LIM * HEIGHT_LIM
        cx0 = gx // 128
        cy0 = gy // 128
        for cx in range(cx0 - 2, cx0 + 3):
            for cy in range(cy0 - 2, cy0 + 3):
                for idx in self.cells.get((cx, cy), ()):
                    sx, sy = self.samples[idx][0], self.samples[idx][1]
                    d = (sx - gx) * (sx - gx) + (sy - gy) * (sy - gy)
                    if d < best_d:
                        best_d = d
                        best = idx
        return best

    def metres(self, idx):
        if idx is None:
            return None
        return self.samples[idx][4] / 2.0


def height_drop(heights, dropped_rows, kept_near):
    doomed = set()
    for _id, _cls, _area, x, y, _ward, _pop in dropped_rows:
        idx = heights.nearest(x, y)
        if idx is not None:
            doomed.add(idx)
    log(f'mẫu cao gần mộ {len(doomed)}')
    keep = {idx for idx in kept_near if idx in doomed}
    gone = doomed - keep
    log(f'mẫu cao gỡ {len(gone)} giữ chung {len(keep)}')
    return gone


def write_heights(path, heights, gone):
    by_tile = defaultdict(list)
    for idx, sample in enumerate(heights.samples):
        if idx in gone:
            continue
        _gx, _gy, px, py, h2, pad, ti, _ri = sample
        by_tile[ti].append((px, py, h2, pad))
    order = []
    body = bytearray()
    table = bytearray()
    start = 0
    for ti, (key, _s, _c) in enumerate(heights.tiles):
        recs = by_tile.get(ti)
        if not recs:
            continue
        table += struct.pack('<III', key, start, len(recs))
        start += len(recs)
        order.append(key)
        for rec in recs:
            body += struct.pack('<HHHH', *rec)
    out = bytearray(b'GBH2')
    out += struct.pack('<II', len(order), start)
    out += table
    out += body
    with open(path, 'wb') as handle:
        handle.write(out)
    return start


def breaks(vals):
    if not vals:
        return (0, 0, 0, 1)

    def q(p):
        i = min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))
        return vals[i]

    med = q(0.5) or 1
    return (q(0.25), q(0.5), q(0.75), med)


def pack(n, fp, area, fai, bq1, bq2, bq3, med):
    cov = (100.0 * fp / area) if area else 0
    if cov < 0:
        cov = 0
    rel = (fai / med) if med else 0
    cls = 0 if n <= 0 else (0 if fai <= bq1 else 1 if fai <= bq2 else 2 if fai <= bq3 else 3)
    return [int(n), round(fp), round(cov, 1), (None if n <= 0 else cls), round(rel, 2)]


def recompute_agg(kept_rows):
    with open(AGG, encoding='utf-8') as handle:
        agg = json.load(handle)
    origin = agg['origin']
    ox, oy = origin
    dlng = agg['dlng']
    dlat = agg['dlat']
    ward_area = {}
    for ward in agg['wards']:
        cov = ward.get('cov') or 0
        ward_area[ward['name']] = (ward['fp'] / (cov / 100.0)) if cov else 0
    wards = defaultdict(lambda: [0, 0.0, 0.0])
    cells = defaultdict(lambda: [0, 0.0])
    kept_n = 0
    pts = []
    for bid, _cls, area, x, y, ward, _pop, h in kept_rows:
        kept_n += 1
        hh = 0.0 if h is None else h
        vol = area * hh
        if ward:
            slot = wards[ward]
            slot[0] += 1
            slot[1] += area
            slot[2] += vol
        col = math.floor((x - ox) / dlng)
        row = math.floor((y - oy) / dlat)
        cell = cells[(col, row)]
        cell[0] += 1
        cell[1] += vol
        pts.append((bid, area, x, y, hh))
    fai_pos = []
    for name, area in ward_area.items():
        n, fp, vol = wards.get(name, (0, 0.0, 0.0))
        if n > 0 and area:
            fai_pos.append(vol / area)
    wq1, wq2, wq3, wmed = breaks(sorted(fai_pos))
    for ward in agg['wards']:
        name = ward['name']
        n, fp, vol = wards.get(name, (0, 0.0, 0.0))
        area = ward_area.get(name) or 0
        fai = (vol / area) if area else 0
        n_, fp_, cov, cls, rel = pack(n, fp, area, fai, wq1, wq2, wq3, wmed)
        ward['n'] = n_
        ward['fp'] = fp_
        ward['cov'] = cov
        ward['cls'] = cls
        ward['fai'] = rel
    log('lô quy hoạch')
    with open(LOTS, encoding='utf-8') as handle:
        lots_fc = json.load(handle)
    geoms = []
    keys = []
    areas = []
    for feat in lots_fc.get('features') or []:
        key = (feat.get('properties') or {}).get('k')
        if not key:
            continue
        geom = shape(feat['geometry'])
        if not geom.is_valid:
            geom = make_valid(geom)
        if geom.is_empty:
            continue
        center = geom.centroid
        geoms.append(geom)
        keys.append(key)
        areas.append(abs(geom.area) * M_PER_DEG * (M_PER_DEG * math.cos(math.radians(center.y))))
    tree = STRtree(geoms)
    stats = [[0, 0.0, 0.0] for _ in geoms]
    for n, (_bid, area, x, y, hh) in enumerate(pts, 1):
        found = tree.query(Point(x, y), predicate='intersects')
        for j in found:
            slot = stats[int(j)]
            slot[0] += 1
            slot[1] += area
            slot[2] += area * hh
        if n % 200000 == 0:
            log(f'gán lô {n}')
    lot_rows = [
        (keys[j], stats[j][0], stats[j][1], stats[j][2], areas[j])
        for j in range(len(keys))
    ]
    lot_fai = sorted((vol / area) for _k, n, _fp, vol, area in lot_rows if n and area and area > 0)
    lq1, lq2, lq3, lmed = breaks(lot_fai)
    old_lots = agg['lots']
    lots_out = {}
    for key, n, fp, vol, area in lot_rows:
        fai = (vol / area) if area else 0
        head = pack(n, fp, area or 0, fai, lq1, lq2, lq3, lmed)
        tail = (old_lots.get(key) or [])[5:]
        lots_out[key] = head + list(tail)
    for key, old in old_lots.items():
        if key not in lots_out:
            lots_out[key] = old
    agg['lots'] = lots_out
    cell_fai = sorted(vol / CELL_AREA for n, vol in cells.values() if n > 0)
    cq1, cq2, cq3, _med = breaks(cell_fai)
    grid = []
    for (col, row), (n, vol) in cells.items():
        fai = vol / CELL_AREA
        cls = 0 if fai <= cq1 else 1 if fai <= cq2 else 2 if fai <= cq3 else 3
        grid.append([int(col), int(row), cls])
    grid.sort()
    agg['grid'] = grid
    agg['buildings'] = kept_n
    note = agg.get('note') or ''
    extra = ' Dấu chân giao thửa địa chính 2016 mã NTD đã gỡ khỏi file phục vụ, không kể diện tích hay chiều cao.'
    if extra.strip() not in note:
        agg['note'] = note.rstrip() + extra
    with open(AGG, 'w', encoding='utf-8') as handle:
        json.dump(agg, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'agg {kept_n} công trình, {len(grid)} ô, {len(lot_rows)} lô')


def rewrite_jsonl(dropped, attrs):
    if not os.path.exists(BEFORE):
        os.link(JSONL, BEFORE)
    os.makedirs(os.path.dirname(ARCHIVE), exist_ok=True)
    wards = Counter()
    for row in attrs.values():
        wards[row['ward'] or '(không phường)'] += 1
    meta = {
        'type': 'meta',
        'removed': len(dropped),
        'wards': dict(sorted(wards.items(), key=lambda item: (-item[1], item[0]))),
        'rule': 'Thửa 2016 mã NTD (token, kể cả NTD+CLN và CLN+NTD). Trọng tâm trong thửa hoặc hình giao thửa. Không lọc diện tích, chiều cao.',
        'note': 'App không nạp file này. Khôi phục: python3 scripts/restore-ntd-footprints.py'
    }
    tmp_jsonl = JSONL + '.stripped'
    written = 0
    with gzip.open(ARCHIVE, 'wt', encoding='utf-8') as archive, open(tmp_jsonl, 'w', encoding='utf-8') as out:
        archive.write(json.dumps(meta, ensure_ascii=False) + '\n')
        with open(JSONL, encoding='utf-8') as handle:
            for index, line in enumerate(handle, 1):
                if index not in dropped:
                    out.write(line if line.endswith('\n') else line + '\n')
                    written += 1
                    continue
                feat = json.loads(line)
                prop = attrs[index]
                archive.write(json.dumps({
                    'type': 'Feature',
                    'id': index,
                    'properties': prop,
                    'geometry': feat['geometry']
                }, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(tmp_jsonl, JSONL)
    log(f'jsonl còn {written}, kho {os.path.getsize(ARCHIVE)} byte')
    return meta


def tippecanoe():
    os.makedirs(os.path.join(TMP, 'tip'), exist_ok=True)
    cmd = [
        'tippecanoe',
        '-o', PMT,
        '--force',
        '--layer=gba',
        '--attribution=Global Building Atlas, TUM; footprints Google, Microsoft, OpenStreetMap; CC BY-NC 4.0, ODbL',
        '--description=Dấu chân công trình TP. Huế, nhóm chiều cao tương đối, đã gỡ thửa NTD',
        '--minimum-zoom=13',
        '--maximum-zoom=16',
        '--drop-smallest-as-needed',
        '--extend-zooms-if-still-dropping',
        '--maximum-tile-bytes=2500000',
        '--no-feature-limit',
        '--simplify-only-low-zooms',
        '--no-tiny-polygon-reduction-at-maximum-zoom',
        '--include=c',
        '--attribute-type=c:int',
        '--read-parallel',
        '--temporary-directory=' + os.path.join(TMP, 'tip'),
        JSONL
    ]
    log('tippecanoe')
    subprocess.check_call(cmd)
    log(f'pmtiles {os.path.getsize(PMT)} byte')


def strip_mask(parcels):
    with open(MASK, encoding='utf-8') as handle:
        mask = json.load(handle)
    before = len(mask['features'])
    mask['features'] = [feat for feat in mask['features'] if (feat.get('properties') or {}).get('src') != 'ntd']
    mask['note'] = (
        'Đã gỡ dấu chân giao thửa địa chính 2016 mã NTD khỏi PMTiles, không kể diện tích hay chiều cao. '
        'Mặt nạ còn đất nghĩa trang quy hoạch, OSM và cụm sườn: ẩn lúc xem nếu dưới 60 m² và không cao quá 3,5 m. '
        'Cụm sườn cao không quá 2,5 m thì ẩn tới dưới 180 m². enabled=false thì vẽ lại phần còn lại.'
    )
    with open(MASK, 'w', encoding='utf-8') as handle:
        json.dump(mask, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'mặt nạ {before} -> {len(mask["features"])}')
    tree = STRtree(parcels)

    def hits(geom):
        geom = shape(geom)
        if not geom.is_valid:
            geom = make_valid(geom)
        return len(tree.query(geom, predicate='intersects')) > 0

    with open(MISSING, encoding='utf-8') as handle:
        missing = json.load(handle)
    m0 = len(missing['features'])
    missing['features'] = [feat for feat in missing['features'] if not hits(feat['geometry'])]
    with open(MISSING, 'w', encoding='utf-8') as handle:
        json.dump(missing, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'mất dấu chân Microsoft {m0} -> {len(missing["features"])}')
    with open(OVERRIDES, encoding='utf-8') as handle:
        overrides = json.load(handle)
    hit_names = []
    for feat in overrides.get('features') or []:
        if hits(feat['geometry']):
            hit_names.append((feat.get('properties') or {}).get('name') or (feat.get('properties') or {}).get('id'))
    # Ranh khu (chung cư, khách sạn) có thể chạm thửa NTD mà khối nhà không phải mộ. Không xóa override.
    log(f'override chạm NTD, giữ nguyên: {hit_names or "không"}')


def point_srcs(lng, lat):
    with open(MASK, encoding='utf-8') as handle:
        mask = json.load(handle)
    found = []
    pt_geom = shape({'type': 'Point', 'coordinates': [lng, lat]})
    for feat in mask['features']:
        geom = shape(feat['geometry'])
        if geom.covers(pt_geom):
            found.append((feat.get('properties') or {}).get('src'))
    return found


def main():
    sizes = {
        'pmtiles': 46843680,
        'bin': 7806008,
        'agg': 3945034,
        'mask': 5910235,
        'missing': 50743
    }
    parcels = load_ntd()
    if not parcels:
        raise SystemExit('không có thửa NTD')
    cache = os.path.join(TMP, 'ntd-drop-rows.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as handle:
            rows = [tuple(row) for row in json.load(handle)]
        dropped = {row[0] for row in rows}
        log(f'dùng cache {len(dropped)} id')
    else:
        dropped, rows = drop_ids(parcels)
        with open(cache, 'w', encoding='utf-8') as handle:
            json.dump(rows, handle)
    if not dropped:
        raise SystemExit('không gỡ công trình nào')
    heights = Heights(BIN)
    log(f'chiều cao Vinpearl {heights.metres(heights.nearest(107.594238, 16.463008))}')
    attrs = {}
    for bid, cls, area, x, y, ward, pop in rows:
        idx = heights.nearest(x, y)
        attrs[bid] = {
            'c': int(cls),
            'area_m2': round(float(area), 2),
            'x': x,
            'y': y,
            'ward': ward,
            'pop': pop,
            'h': heights.metres(idx)
        }
    kept_xy = []
    kept_near = []
    kept_rows = []
    con = connect()
    kept = con.execute("""
        SELECT id, cls, area_m2, x, y, coalesce(ward, ''), coalesce(pop, 0)
        FROM read_parquet(?)
        WHERE id NOT IN (SELECT UNNEST(?))
    """, [PARQUET, list(dropped)]).fetchall()
    con.close()
    for n, (bid, cls, area, x, y, ward, pop) in enumerate(kept, 1):
        kept_xy.append((x, y))
        idx = heights.nearest(x, y)
        kept_near.append(idx)
        kept_rows.append((bid, cls, area, x, y, ward, pop, heights.metres(idx)))
        if n % 200000 == 0:
            log(f'chiều cao nhà giữ {n}')
    with open(HF, encoding='utf-8') as handle:
        hf = json.load(handle)
    if hf.get('buildings') == 880408 and os.path.getsize(BIN) < 7806008:
        samples = 880408
        log('giữ bin đã gỡ')
    else:
        gone = height_drop(heights, rows, kept_near)
        samples = write_heights(BIN, heights, gone)
        hf['buildings'] = samples
        with open(HF, 'w', encoding='utf-8') as handle:
            json.dump(hf, handle, ensure_ascii=False, separators=(',', ':'))
    if os.path.exists(ARCHIVE) and sum(1 for _ in open(JSONL, encoding='utf-8')) == 880400 and os.path.getsize(PMT) > 40_000_000:
        with gzip.open(ARCHIVE, 'rt', encoding='utf-8') as handle:
            meta = json.loads(handle.readline())
        log('giữ jsonl, kho lưu và pmtiles đã dựng')
    else:
        meta = rewrite_jsonl(dropped, attrs)
        tippecanoe()
    recompute_agg(kept_rows)
    strip_mask(parcels)
    probes = {
        'an_cuu': point_srcs(107.594264, 16.443778),
        'ngu_binh_a': point_srcs(107.593, 16.446),
        'ngu_binh_b': point_srcs(107.5942, 16.4478)
    }
    after = {
        name: os.path.getsize(path)
        for name, path in {
            'pmtiles': PMT, 'bin': BIN, 'agg': AGG, 'mask': MASK, 'missing': MISSING,
            'archive': ARCHIVE
        }.items()
    }
    report = {
        'removed': len(dropped),
        'kept': len(kept_rows),
        'wards': meta['wards'],
        'bytesBefore': sizes,
        'bytesAfter': after,
        'heightSamples': samples,
        'maskProbe': probes
    }
    with open(REPORT, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    log(json.dumps(report, ensure_ascii=False)[:2000])
    log(f'báo cáo {REPORT}')


if __name__ == '__main__':
    main()
