#!/usr/bin/env python3
# Ứng viên chung cư cao tầng và phân bổ dân số phương pháp B sau khi trừ dân chung cư.
# Không ghi mét chiều cao. Bậc GBA chỉ để nhận nhóm rất cao (cls = 3).
#   python3 scripts/gba-apartments.py

import json
import math
import os
import re
import time
import unicodedata

import duckdb
import numpy as np
import rasterio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'gba')
ART = os.environ.get('GBA_COMPARE_ART', '/opt/cursor/artifacts')
M_PER_DEG = 111320.0
MIN_M2 = float(os.environ.get('GBA_APT_M2', '300'))
CLUSTER_M = 35.0
HH = 3.3
M2_PERSON = 25.0
EFF = 0.75
FLOOD_M = 5

APT_RE = re.compile(r'CHUNG ?CU|NHA O CHUNG|DAT O CHUNG|DAT CHUNG CU|O CAO TANG|NHA O CAO TANG|DAT O CAO TANG')
BAD_RE = re.compile(r'KHACH SAN|THUONG MAI|NGHI DUONG|DU LICH|VAN PHONG')
MIX_RE = re.compile(r'HON HOP')
RES_RE = r'(^|[^A-Z])(ODT|ONT)([^A-Z]|$)'


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def fold(text):
    s = unicodedata.normalize('NFD', str(text or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.replace('đ', 'd').replace('Đ', 'D').upper()


def lot_kind(layer, name):
    blob = fold(f'{layer or ""} {name or ""}')
    if BAD_RE.search(blob) and not APT_RE.search(blob):
        return ''
    if APT_RE.search(blob):
        return 'apt' if 'CHUNG' in blob else 'high'
    if MIX_RE.search(blob):
        return 'mix'
    return ''


def connect():
    con = duckdb.connect()
    con.execute('LOAD spatial')
    con.execute('SET preserve_insertion_order=false')
    con.execute('SET threads=3')
    con.execute("SET memory_limit='6GB'")
    os.makedirs(os.path.join(TMP, 'duck'), exist_ok=True)
    con.execute(f"SET temp_directory='{os.path.join(TMP, 'duck')}'")
    return con


def vn_int(n):
    if n is None or not math.isfinite(float(n)):
        return '—'
    return f'{int(math.floor(float(n) + 0.5)):,}'.replace(',', '.')


def levels_of(tags):
    raw = str((tags or {}).get('building:levels') or '').split(';')[0].strip().replace(',', '.')
    try:
        n = float(raw)
    except ValueError:
        return None
    if not math.isfinite(n) or n <= 0 or n > 80:
        return None
    return int(math.floor(n + 0.5))


def sample_dem(x, y):
    paths = [os.path.join(TMP, 'dem_n16_e107.tif'), os.path.join(TMP, 'dem_n16_e108.tif')]
    out = np.full(len(x), np.nan, dtype='float64')
    srcs = [rasterio.open(p) for p in paths if os.path.exists(p)]
    try:
        for src in srcs:
            b = src.bounds
            m = (x >= b.left) & (x <= b.right) & (y >= b.bottom) & (y <= b.top)
            idx = np.flatnonzero(m)
            for start in range(0, len(idx), 80000):
                part = idx[start:start + 80000]
                coords = list(zip(x[part].tolist(), y[part].tolist()))
                vals = np.fromiter((v[0] for v in src.sample(coords)), dtype='float64', count=len(part))
                out[part] = vals
    finally:
        for src in srcs:
            src.close()
    out[~np.isfinite(out)] = np.nan
    out[out < -100] = np.nan
    return out


def elev_bin(elev):
    r = np.where(np.isnan(elev), np.nan, np.floor(elev + 0.5))
    return np.clip(r, -1, 40)


def served(x, y, ward, facs, same):
    hit = np.zeros(len(x), dtype=bool)
    if not len(x) or not facs:
        return hit
    if same:
        by = {}
        for f in facs:
            by.setdefault(f['ward'], []).append(f)
        wards, inv = np.unique(ward, return_inverse=True)
        for i, w in enumerate(wards):
            sel = np.flatnonzero(inv == i)
            fs = by.get(str(w)) or []
            if not len(sel) or not fs:
                continue
            sx, sy = x[sel], y[sel]
            cos = np.cos(np.radians(sy))
            sub = np.zeros(len(sel), dtype=bool)
            for f in fs:
                dx = (sx - f['lng']) * M_PER_DEG * cos
                dy = (sy - f['lat']) * M_PER_DEG
                sub |= (dx * dx + dy * dy) <= f['radius'] ** 2
            hit[sel] = sub
        return hit
    cos = np.cos(np.radians(y))
    for f in facs:
        dx = (x - f['lng']) * M_PER_DEG * cos
        dy = (y - f['lat']) * M_PER_DEG
        hit |= (dx * dx + dy * dy) <= f['radius'] ** 2
    return hit


def confidence(signals):
    score = 0
    if 'osm_apt' in signals and 'osm_levels' in signals:
        score += 2
    elif 'osm_apt' in signals or ('osm_res' in signals and 'osm_levels' in signals):
        score += 1
    if 'gba' in signals and ('cad' in signals or 'lot_apt' in signals or 'lot_high' in signals):
        score += 1
    elif 'gba' in signals and 'lot_mix' in signals:
        score += 0
    if 'lot_apt' in signals or 'lot_high' in signals:
        score += 1
    if score >= 2:
        return 'high'
    if score == 1:
        return 'medium'
    return 'low'


def pop_of(floors, units, residents, footprint, cfg=None):
    cfg = cfg or {}
    hh = float(cfg.get('hhSize', HH))
    m2 = float(cfg.get('m2PerPerson', M2_PERSON))
    eff = float(cfg.get('efficiency', EFF))
    if residents is not None and float(residents) > 0:
        return float(residents), 'dan'
    if units is not None and float(units) > 0:
        return float(units) * hh, 'can'
    if floors and footprint and float(floors) > 0 and float(footprint) > 0 and m2 > 0:
        return float(floors) * float(footprint) * eff / m2, 'tang'
    return 0.0, 'thieu'


def main():
    fac_path = os.path.join(TMP, 'facilities.json')
    if not os.path.exists(fac_path):
        raise SystemExit('Thiếu facilities.json — chạy gba-pop-compare.py trước')
    facs = json.load(open(fac_path, encoding='utf-8'))
    groups = {g: [f for f in facs if f.get('group') == g] for g in ('school', 'health', 'park')}

    con = connect()
    log('phường và nhà ở')
    con.execute(f"""
        CREATE TABLE wards AS
        SELECT tenXa AS name,
               coalesce(danSoNum, try_cast(danSo AS DOUBLE), 0) AS pop,
               ST_MakeValid(geom) AS geom
        FROM ST_Read('{os.path.join(TMP, 'wards.geojson')}')
        WHERE tenXa IS NOT NULL AND tenXa <> ''
    """)
    labeled = os.path.join(TMP, 'labeled.parquet')
    con.execute(f"""
        CREATE TABLE bldg AS
        SELECT id, ward, pop, area_m2, cls, x, y, wb
        FROM read_parquet('{labeled}')
        WHERE residential
    """)
    n_res = con.execute('SELECT count(*) FROM bldg').fetchone()[0]
    log(f'nhà ở {n_res}')

    log('thửa đất ở')
    cad = os.path.join(TMP, 'cad-res.jsonl')
    con.execute(f"""
        CREATE TABLE cad AS
        SELECT ST_MakeValid(ST_SetCRS(ST_GeomFromGeoJSON(to_json(geometry)::VARCHAR), 'EPSG:4326')) AS geom
        FROM read_ndjson('{cad}', columns={{'l': 'VARCHAR', 'geometry': 'JSON'}}, ignore_errors=true)
        WHERE regexp_matches(upper(l), '{RES_RE}')
    """)
    con.execute(f"""
        CREATE TABLE tall AS
        SELECT * FROM bldg WHERE area_m2 >= {MIN_M2} AND cls = 3
    """)
    log(f"dấu chân rất cao ≥ {int(MIN_M2)} m²: {con.execute('SELECT count(*) FROM tall').fetchone()[0]}")
    con.execute("""
        CREATE TABLE cad_hit AS
        SELECT DISTINCT t.id
        FROM tall t
        JOIN cad c ON ST_Intersects(c.geom, ST_SetCRS(ST_Point(t.x, t.y), 'EPSG:4326'))
    """)
    con.execute('DROP TABLE cad')
    log(f"trên thửa ODT/ONT {con.execute('SELECT count(*) FROM cad_hit').fetchone()[0]}")

    log('lô quy hoạch')
    con.execute(f"""
        CREATE TABLE lots AS
        SELECT k, layer, name,
               ST_MakeValid(ST_SetCRS(geom, 'EPSG:4326')) AS geom
        FROM ST_Read('{os.path.join(TMP, 'lots-use.geojson')}')
    """)
    rows = con.execute('SELECT k, layer, name FROM lots').fetchall()
    kinds = [(k, lot_kind(layer, name)) for k, layer, name in rows]
    kinds = [r for r in kinds if r[1]]
    con.execute('CREATE TABLE lot_kind (k VARCHAR, kind VARCHAR)')
    if kinds:
        con.executemany('INSERT INTO lot_kind VALUES (?, ?)', kinds)
    log(f'lô có chữ chung cư / cao tầng / hỗn hợp {len(kinds)}')
    con.execute("""
        CREATE TABLE lot_hit AS
        SELECT id, kind, lot_name, k FROM (
            SELECT t.id, lk.kind, l.name AS lot_name, l.k,
                   row_number() OVER (PARTITION BY t.id ORDER BY ST_Area(l.geom)) AS rn
            FROM tall t
            JOIN lots l ON ST_Intersects(l.geom, ST_SetCRS(ST_Point(t.x, t.y), 'EPSG:4326'))
            JOIN lot_kind lk ON lk.k = l.k
        ) WHERE rn = 1
    """)

    named = con.execute("""
        SELECT l.k, l.layer, l.name,
               ST_X(ST_Centroid(l.geom)), ST_Y(ST_Centroid(l.geom)),
               ST_Area(l.geom) * 111320.0 * (111320.0 * cos(radians(ST_Y(ST_Centroid(l.geom)))))
        FROM lots l JOIN lot_kind lk ON lk.k = l.k
        WHERE lk.kind IN ('apt', 'high')
    """).fetchall()
    log(f'lô đặt tên chung cư hoặc đất ở cao tầng {len(named)}')

    tall_rows = con.execute("""
        SELECT t.id, t.ward, t.pop, t.area_m2, t.cls, t.x, t.y, t.wb,
               c.id IS NOT NULL, h.kind, h.lot_name, h.k
        FROM tall t
        LEFT JOIN cad_hit c ON c.id = t.id
        LEFT JOIN lot_hit h ON h.id = t.id
    """).fetchall()

    osm_path = os.path.join(TMP, 'osm-apt.json')
    osm_raw = json.load(open(osm_path, encoding='utf-8')) if os.path.exists(osm_path) else {'elements': []}
    osm_pts = []
    for el in osm_raw.get('elements') or []:
        tags = el.get('tags') or {}
        b = tags.get('building') or ''
        if b not in ('apartments', 'residential'):
            continue
        lv = levels_of(tags)
        if b == 'residential' and (lv is None or lv < 5):
            continue
        center = el.get('center') or {}
        lat, lng = center.get('lat'), center.get('lon')
        if lat is None or lng is None:
            continue
        osm_pts.append({
            'lng': float(lng), 'lat': float(lat), 'levels': lv, 'building': b,
            'name': tags.get('name:vi') or tags.get('name') or ''
        })
    log(f'OSM {len(osm_pts)}')
    if osm_pts:
        con.execute('CREATE TABLE osm (i INTEGER, x DOUBLE, y DOUBLE)')
        con.executemany('INSERT INTO osm VALUES (?, ?, ?)', [(i, p['lng'], p['lat']) for i, p in enumerate(osm_pts)])
        hit = dict(con.execute("""
            SELECT i, name FROM (
                SELECT o.i, w.name,
                       row_number() OVER (PARTITION BY o.i ORDER BY w.name) AS rn
                FROM osm o
                JOIN wards w ON ST_Intersects(w.geom, ST_SetCRS(ST_Point(o.x, o.y), 'EPSG:4326'))
            ) WHERE rn = 1
        """).fetchall())
        for i, p in enumerate(osm_pts):
            p['ward'] = hit.get(i) or ''
    osm_pts = [p for p in osm_pts if p.get('ward')]
    log(f'OSM trong ranh phường {len(osm_pts)}')

    # Gán OSM vào lô đặt tên hoặc dấu chân gần nhất
    tall_xy = np.array([[r[5], r[6]] for r in tall_rows], dtype='float64') if tall_rows else np.zeros((0, 2))

    def near_tall(lng, lat, meters):
        if not len(tall_xy):
            return []
        cos = math.cos(math.radians(lat))
        dx = (tall_xy[:, 0] - lng) * M_PER_DEG * cos
        dy = (tall_xy[:, 1] - lat) * M_PER_DEG
        return np.flatnonzero(dx * dx + dy * dy <= meters * meters).tolist()

    used_tall = set()
    candidates = []

    def add(rec):
        candidates.append(rec)

    # Lô đặt tên: một ứng viên, gom dấu chân rất cao bên trong
    named_ids = {r[0] for r in named}
    inside = {}
    if named_ids:
        q = con.execute("""
            SELECT h.k, t.id FROM lot_hit h
            JOIN tall t ON t.id = h.id
            WHERE h.kind IN ('apt', 'high')
        """).fetchall()
        for k, bid in q:
            inside.setdefault(k, []).append(bid)
    by_id = {r[0]: r for r in tall_rows}
    for k, layer, name, x, y, area in named:
        ids = inside.get(k) or []
        for bid in ids:
            used_tall.add(bid)
        members = [by_id[i] for i in ids if i in by_id]
        footprint = sum(m[3] for m in members) if members else float(area or 0)
        ward = members[0][1] if members else ''
        if not ward:
            w = con.execute(
                "SELECT name FROM wards WHERE ST_Intersects(geom, ST_SetCRS(ST_Point(?, ?), 'EPSG:4326')) LIMIT 1",
                [float(x), float(y)]
            ).fetchone()
            ward = w[0] if w else ''
        if not ward:
            continue
        signals = {'lot_apt' if lot_kind(layer, name) == 'apt' else 'lot_high', 'name'}
        if members:
            signals.add('gba')
            if any(m[8] for m in members):
                signals.add('cad')
        lx, ly = (members[0][5], members[0][6]) if members else (float(x), float(y))
        # OSM gần tâm lô
        for p in osm_pts:
            if p.get('used'):
                continue
            if p['ward'] != ward:
                continue
            cos = math.cos(math.radians(ly))
            if ((p['lng'] - lx) * M_PER_DEG * cos) ** 2 + ((p['lat'] - ly) * M_PER_DEG) ** 2 <= CLUSTER_M ** 2:
                p['used'] = True
                p['lot'] = k
                signals.add('osm_apt' if p['building'] == 'apartments' else 'osm_res')
                if p['levels'] and p['levels'] >= 5:
                    signals.add('osm_levels')
        floors = max((p['levels'] for p in osm_pts if p.get('lot') == k and p.get('levels')), default=None)
        add({
            'name': (name or layer or 'Chung cư').split(' – ')[0].strip()[:80],
            'lat': ly, 'lng': lx, 'ward': ward,
            'floors': floors, 'units': None, 'residents': None,
            'footprint': round(footprint),
            'signals': signals,
            'source': 'quyhoach',
            'members': len(members) or 1
        })

    # OSM chưa gán
    for p in osm_pts:
        if p.get('used'):
            continue
        p['used'] = True
        idxs = [i for i in near_tall(p['lng'], p['lat'], CLUSTER_M) if tall_rows[i][0] not in used_tall and tall_rows[i][1] == p['ward']]
        members = []
        for i in idxs:
            used_tall.add(tall_rows[i][0])
            members.append(tall_rows[i])
        signals = {'osm_apt' if p['building'] == 'apartments' else 'osm_res'}
        if p['levels'] and p['levels'] >= 5:
            signals.add('osm_levels')
        if members:
            signals.add('gba')
            if any(m[8] for m in members):
                signals.add('cad')
            kind = next((m[9] for m in members if m[9]), '')
            if kind == 'apt':
                signals.add('lot_apt')
            elif kind == 'high':
                signals.add('lot_high')
            elif kind == 'mix':
                signals.add('lot_mix')
        footprint = sum(m[3] for m in members) if members else 0
        add({
            'name': (p['name'] or 'Chung cư OSM')[:80],
            'lat': p['lat'], 'lng': p['lng'], 'ward': p['ward'],
            'floors': p['levels'], 'units': None, 'residents': None,
            'footprint': round(footprint) if footprint else None,
            'signals': signals,
            'source': 'osm',
            'members': len(members) or 1
        })

    # Dấu chân còn lại: chỉ khi có thửa đất ở hoặc lô đúng loại
    for r in tall_rows:
        if r[0] in used_tall:
            continue
        cad = bool(r[8])
        kind = r[9] or ''
        if not cad and not kind:
            continue
        signals = {'gba'}
        if cad:
            signals.add('cad')
        if kind == 'apt':
            signals.add('lot_apt')
        elif kind == 'high':
            signals.add('lot_high')
        elif kind == 'mix':
            signals.add('lot_mix')
        label = (r[10] or '').split(' – ')[0].strip()
        if not label:
            label = 'Khối nhà ở rất cao' if cad else 'Khối trên lô hỗn hợp'
        add({
            'name': label[:80],
            'lat': r[6], 'lng': r[5], 'ward': r[1],
            'floors': None, 'units': None, 'residents': None,
            'footprint': round(r[3]),
            'signals': signals,
            'source': 'gba',
            'members': 1,
            'bid': r[0]
        })

    log(f'ứng viên {len(candidates)}')

    # Cao độ và vùng phục vụ của ứng viên
    ax = np.array([c['lng'] for c in candidates], dtype='float64')
    ay = np.array([c['lat'] for c in candidates], dtype='float64')
    award = np.array([c['ward'] for c in candidates])
    elev = sample_dem(ax, ay) if len(candidates) else np.zeros(0)
    bins = elev_bin(elev) if len(candidates) else np.zeros(0)
    catch = {}
    for g, fl in groups.items():
        catch[g] = served(ax, ay, award, fl, True) if len(candidates) else np.zeros(0, dtype=bool)
        catch[g + 'X'] = served(ax, ay, award, fl, False) if len(candidates) else np.zeros(0, dtype=bool)

    items = []
    for i, c in enumerate(candidates):
        conf = confidence(c['signals'])
        people, how = pop_of(c['floors'], c['units'], c['residents'], c['footprint'])
        items.append({
            'id': f'CC{i+1:04d}',
            'name': c['name'],
            'lat': round(float(c['lat']), 6),
            'lng': round(float(c['lng']), 6),
            'ward': c['ward'],
            'floors': c['floors'],
            'units': c['units'],
            'residents': c['residents'],
            'footprint': c['footprint'],
            'elev': None if not math.isfinite(float(elev[i])) else int(bins[i]),
            'school': bool(catch['school'][i]),
            'health': bool(catch['health'][i]),
            'park': bool(catch['park'][i]),
            'schoolX': bool(catch['schoolX'][i]),
            'healthX': bool(catch['healthX'][i]),
            'parkX': bool(catch['parkX'][i]),
            'source': c['source'],
            'confidence': conf,
            'verified': False,
            'signals': sorted(c['signals']),
            'pop': round(people),
            'how': how
        })

    # Trọng số nhà thấp tầng = nhà ở trừ các dấu chân đã gán vào ứng viên có tín hiệu gba
    apt_bids = set(used_tall)
    for c in candidates:
        if c.get('bid'):
            apt_bids.add(c['bid'])

    log('trọng số nhà thấp tầng và ngập')
    b = con.execute('SELECT id, ward, pop, x, y, wb FROM bldg').fetchall()
    bid = np.array([r[0] for r in b])
    bward = np.array([r[1] for r in b])
    bpop = np.array([r[2] for r in b], dtype='float64')
    bx = np.array([r[3] for r in b], dtype='float64')
    by = np.array([r[4] for r in b], dtype='float64')
    bw = np.array([r[5] for r in b], dtype='float64')
    apt_arr = np.fromiter(apt_bids, dtype='int64', count=len(apt_bids)) if apt_bids else np.zeros(0, dtype='int64')
    keep = ~np.isin(bid, apt_arr)
    log(f'bỏ {int((~keep).sum())} dấu chân đã tính là chung cư')
    belev = sample_dem(bx, by)
    bbin = elev_bin(belev)

    # pixel cũ
    log('pixel WorldPop để so sánh')
    wp = con.execute(f"SELECT x, y, ward, pop FROM read_parquet('{os.path.join(TMP, 'wp_pixels.parquet')}')").fetchall()
    px = np.array([r[0] for r in wp], dtype='float64')
    py = np.array([r[1] for r in wp], dtype='float64')
    pward = np.array([r[2] for r in wp])
    ppop = np.array([r[3] for r in wp], dtype='float64')
    # chia đều: mỗi pixel một phần pop/count
    from collections import Counter
    pcount = Counter(pward.tolist())
    pshare = np.array([ppop[i] / pcount[pward[i]] if pcount[pward[i]] else 0 for i in range(len(pward))])
    pelev = sample_dem(px, py)
    pbin = elev_bin(pelev)

    ward_names = sorted(set(bward.tolist()) | set(c['ward'] for c in items))
    wards_out = []
    warns = []
    for name in ward_names:
        m = bward == name
        low = m & keep & np.isfinite(bbin)
        low_w = float(bw[low].sum())
        pop = float(bpop[m][0]) if np.any(m) else 0.0
        if pop <= 0:
            hit = con.execute('SELECT pop FROM wards WHERE name = ?', [name]).fetchone()
            pop = float(hit[0]) if hit else 0.0
        apts = [it for it in items if it['ward'] == name]
        apt_pop = sum(it['pop'] for it in apts)
        warn = apt_pop > pop + 0.5 and pop > 0
        if warn:
            warns.append(name)
        remain = max(0.0, pop - apt_pop)
        bins_w = {}
        if low_w > 0:
            for bb, ww in zip(bbin[low], bw[low]):
                if not math.isfinite(float(bb)):
                    continue
                key = int(bb)
                bins_w[key] = bins_w.get(key, 0.0) + float(ww)
        pm = pward == name
        old_flood = float(pshare[pm & np.isfinite(pbin) & (pbin < FLOOD_M)].sum()) if np.any(pm) else 0.0

        def wsum(mask):
            return float(bw[low & mask].sum()) if low_w > 0 else 0.0

        lx, ly, lw = bx[low], by[low], bward[low]
        row = {
            'name': name,
            'pop': round(pop),
            'lowW': round(low_w, 1),
            'bins': [[k, round(v, 1)] for k, v in sorted(bins_w.items())],
            'oldFlood5': round(old_flood)
        }
        for g in ('school', 'health', 'park'):
            if np.any(low):
                row[g + 'W'] = round(float(bw[low][served(lx, ly, lw, groups[g], True)].sum()), 1)
                row[g + 'X'] = round(float(bw[low][served(lx, ly, lw, groups[g], False)].sum()), 1)
            else:
                row[g + 'W'] = 0
                row[g + 'X'] = 0
            if np.any(pm):
                row['old' + g.capitalize()] = round(float(pshare[pm][served(px[pm], py[pm], pward[pm], groups[g], True)].sum()))
                row['old' + g.capitalize() + 'X'] = round(float(pshare[pm][served(px[pm], py[pm], pward[pm], groups[g], False)].sum()))
            else:
                row['old' + g.capitalize()] = 0
                row['old' + g.capitalize() + 'X'] = 0
        row['apt'] = len(apts)
        row['aptPop'] = round(apt_pop)
        row['remain'] = round(remain)
        row['warn'] = warn
        # dân ngập mới ở mực 5
        flood_w = sum(v for k, v in bins_w.items() if k < FLOOD_M)
        apt_f = sum(it['pop'] for it in apts if it['elev'] is not None and it['elev'] < FLOOD_M)
        row['flood5'] = round(remain * flood_w / low_w + apt_f) if low_w > 0 else round(apt_f)
        wards_out.append(row)

    items.sort(key=lambda it: (-{'high': 3, 'medium': 2, 'low': 1}[it['confidence']], -it['pop'], it['ward']))
    for i, it in enumerate(items):
        it['id'] = f'CC{i+1:04d}'

    pack = {
        'v': 1,
        'hhSize': HH,
        'm2PerPerson': M2_PERSON,
        'efficiency': EFF,
        'minM2': MIN_M2,
        'items': items
    }
    weights = {
        'v': 1,
        'dem': 'Copernicus GLO-30',
        'floodM': FLOOD_M,
        'note': 'Trọng số nhà thấp tầng = diện tích dấu chân nhà ở × (bậc tương đối + 1), đã bỏ dấu chân gán cho chung cư. Dân pixel cũ là WorldPop 2020 chia đều trong phường, chỉ để so sánh.',
        'wards': wards_out
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'apartments.json'), 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT_DIR, 'pop-b.json'), 'w', encoding='utf-8') as f:
        json.dump(weights, f, ensure_ascii=False, separators=(',', ':'))

    # FAQ không gian
    def top_gap(key_new, key_old, outside=True):
        best = None
        for w in wards_out:
            pop = w['pop']
            if pop <= 0:
                continue
            if outside:
                new = max(0, pop - (w['remain'] * (w[key_new] / w['lowW']) if w['lowW'] else 0) - sum(
                    it['pop'] for it in items if it['ward'] == w['name'] and it[{'schoolX': 'schoolX', 'healthX': 'healthX', 'parkX': 'parkX'}[key_new]]
                ))
            else:
                new = w[key_new]
            if best is None or new > best[0]:
                best = (new, w['name'], w.get(key_old))
        return best

    # ngoài vùng = dân phường − dân trong vùng (gồm chung cư trong vùng)
    def outside(flag, weight_key):
        best = None
        for w in wards_out:
            pop = w['pop']
            if pop <= 0:
                continue
            low_in = w['remain'] * (w[weight_key] / w['lowW']) if w['lowW'] else 0
            apt_in = sum(it['pop'] for it in items if it['ward'] == w['name'] and it[flag])
            gap = max(0.0, pop - low_in - apt_in)
            if best is None or gap > best[0]:
                best = (gap, w['name'])
        return best

    faq = []
    school = outside('schoolX', 'schoolX')
    health = outside('healthX', 'healthX')
    park = outside('parkX', 'parkX')
    flood_best = max(wards_out, key=lambda w: w['flood5']) if wards_out else None
    apt_best = max(wards_out, key=lambda w: w['aptPop']) if wards_out else None
    if school:
        faq.append({
            'id': 'pop-out-school',
            'q': 'Phường, xã nào có nhiều người nhất ở ngoài vùng phục vụ trường học?',
            'a': f"{school[1]}: khoảng {vn_int(school[0])} người, sau khi trừ dân chung cư rồi chia phần còn lại theo sàn nhà ở thấp tầng.",
            'wards': [school[1]],
            'source': 'Phương pháp B và danh sách chung cư. Vùng phục vụ tính cả trường ở phường bên cạnh. Bán kính QCVN như bản đồ.'
        })
    if health:
        faq.append({
            'id': 'pop-out-health',
            'q': 'Phường, xã nào có nhiều người nhất ở ngoài vùng phục vụ y tế?',
            'a': f"{health[1]}: khoảng {vn_int(health[0])} người.",
            'wards': [health[1]],
            'source': 'Phương pháp B và danh sách chung cư. Trạm đã duyệt, có quy mô hiện trạng, bán kính QCVN.'
        })
    if park:
        faq.append({
            'id': 'pop-out-park',
            'q': 'Phường, xã nào có nhiều người nhất ở ngoài vùng phục vụ công viên?',
            'a': f"{park[1]}: khoảng {vn_int(park[0])} người.",
            'wards': [park[1]],
            'source': 'Phương pháp B và danh sách chung cư.'
        })
    if flood_best:
        faq.append({
            'id': 'pop-flood-5',
            'q': 'Phường, xã nào có nhiều người nhất ở cao độ dưới 5 m?',
            'a': f"{flood_best['name']}: khoảng {vn_int(flood_best['flood5'])} người (Copernicus GLO-30, mực 5 m).",
            'wards': [flood_best['name']],
            'source': 'Dân chung cư theo cao độ khối nhà; phần còn lại theo trọng số nhà ở thấp tầng. Không phải FABDEM của thanh mô phỏng cũ.'
        })
    if apt_best and apt_best['aptPop'] > 0:
        faq.append({
            'id': 'pop-apt-ward',
            'q': 'Phường, xã nào có dân chung cư ước tính cao nhất?',
            'a': f"{apt_best['name']}: khoảng {vn_int(apt_best['aptPop'])} người trong {apt_best['apt']} chung cư ứng viên.",
            'wards': [apt_best['name']],
            'source': 'Danh sách ứng viên. Dân biết trước, không thì số căn × 3,3, không thì số tầng × dấu chân × 0,75 / 25 m².'
        })
    with open(os.path.join(OUT_DIR, 'pop-faq.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'questions': faq}, f, ensure_ascii=False, indent=2)

    # Báo cáo
    by_conf = Counter(it['confidence'] for it in items)
    by_how = Counter(it['how'] for it in items)
    verified = sum(1 for it in items if it['verified'])
    estimated = sum(1 for it in items if it['how'] != 'thieu')
    missing = sum(1 for it in items if it['how'] == 'thieu')
    city_pop = sum(w['pop'] for w in wards_out)
    city_apt = sum(w['aptPop'] for w in wards_out)
    city_flood = sum(w['flood5'] for w in wards_out)
    city_old_flood = sum(w['oldFlood5'] for w in wards_out)

    def line_ward(w):
        return f"| {w['name']} | {vn_int(w['pop'])} | {w['apt']} | {vn_int(w['aptPop'])} | {vn_int(w['remain'])} | {vn_int(w['flood5'])} | {vn_int(w['oldFlood5'])} | {'vượt' if w['warn'] else ''} |"

    hot = sorted(wards_out, key=lambda w: (-w['apt'], -w['aptPop'], w['name']))
    named = [it for it in items if it['confidence'] == 'high' or it['how'] != 'thieu']
    lines = [
        '# Chung cư và phân bổ dân số phương pháp B',
        '',
        f'- Ứng viên: **{len(items)}** (cao {by_conf.get("high", 0)}, vừa {by_conf.get("medium", 0)}, thấp {by_conf.get("low", 0)}).',
        f'- Đã xác minh trên sheet: **{verified}**. Có số dân ước tính: **{estimated}**. Thiếu số tầng nên chưa tính dân: **{missing}**.',
        f'- Dân chung cư ước tính toàn thành phố: **{vn_int(city_apt)}** / dân số hành chính **{vn_int(city_pop)}**.',
        f'- Phường bị trừ về 0 vì chung cư vượt dân số: **{len(warns)}**.',
        f'- Dân dưới 5 m: mới **{vn_int(city_flood)}**, pixel WorldPop **{vn_int(city_old_flood)}**. Chênh này là cách chia theo sàn nhà ở so với pixel, không phải do 261 người chung cư.',
        '',
        'Dân chung cư: số dân đã biết, không thì số căn × 3,3 người/hộ, không thì số tầng × dấu chân × 0,75 / 25 m²/người. Phần còn lại của phường chia cho nhà ở thấp tầng theo diện tích dấu chân × bậc chiều cao tương đối. Không suy số tầng từ bậc chiều cao tương đối.',
        '',
        'Ứng viên đã có tên hoặc đã tính được dân:',
        '',
    ]
    for it in named:
        lines.append(f"- {it['id']} {it['name']} ({it['ward']}): tin cậy {it['confidence']}, dân {vn_int(it['pop'])}, cách {it['how']}, nguồn {it['source']}.")
    lines.extend([
        '',
        '| Phường | Dân số | Số chung cư | Dân chung cư | Còn lại cho nhà thấp | Ngập < 5 m (mới) | Ngập pixel | Cảnh báo |',
        '|---|---:|---:|---:|---:|---:|---:|---|',
    ])
    lines.extend(line_ward(w) for w in hot)
    text = '\n'.join(lines) + '\n'
    os.makedirs(ART, exist_ok=True)
    with open(os.path.join(ART, 'chung-cu-dan-so.md'), 'w', encoding='utf-8') as f:
        f.write(text)
    with open(os.path.join(OUT_DIR, 'apartments-report.md'), 'w', encoding='utf-8') as f:
        f.write(text)
    log(f'xong ứng viên {len(items)} dân chung cư {city_apt:.0f} cảnh báo {len(warns)}')
    con.close()


if __name__ == '__main__':
    main()
