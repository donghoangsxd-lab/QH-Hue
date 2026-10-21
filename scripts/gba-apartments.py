#!/usr/bin/env python3
# Chung cư hiện trạng = nhà ở xã hội đã hoàn thành (noxh-source.csv).
# Khu còn lại ghi noxh-plan.json, không trừ dân. Dấu chân GBA không tự thành chung cư.
# Dòng source sheet/manual/thuongmai trong apartments.json được giữ để thêm chung cư thương mại.
#   python3 scripts/gba-apartments.py

import csv
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
HH = 3.3
M2_PERSON = 25.0
EFF = 0.75
FLOOD_M = 5

KNOWN_ID = {
    'Chung cư Xuân Phú (CHC2)': 'NOXH-CHC2',
    'Chung cư Aranya (CHC1)': 'NOXH-CHC1',
    'Chung cư Vicoland (CHC3)': 'NOXH-CHC3',
    'Nhà ở xã hội XH3 (West Sky) - Khu phức hợp Thuỷ Vân GĐ 2': 'NOXH-XH3',
}
KEEP_SOURCE = {'sheet', 'manual', 'thuongmai'}


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def fold(text):
    s = unicodedata.normalize('NFD', str(text or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.replace('đ', 'd').replace('Đ', 'D').upper()


def fnum(text):
    s = str(text or '').strip().replace(' ', '')
    if not s:
        return None
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


def uncertain_row(row):
    note = str(row.get('mo_ta') or '')
    return 'lệch' in note.lower() or 'COT GOC LECH' in fold(note)


def plan_id(name, seen):
    if name in KNOWN_ID:
        return KNOWN_ID[name]
    folded = fold(name)
    if 'HUONG SO 1' in folded:
        base = 'QH-I5-1'
    elif 'HUONG SO 2' in folded:
        base = 'QH-I5-2'
    elif 'THANH TOAN' in folded:
        base = 'QH-THANH-TOAN'
    elif 'PHONG HIEN' in folded:
        base = 'QH-PHONG-HIEN'
    else:
        m = re.match(r'^([IVX]+\.\d+(?:\.NOXH-\d+)?)', name.strip())
        if m:
            base = 'QH-' + m.group(1).replace('.', '-')
        else:
            base = 'QH-' + re.sub(r'[^A-Z0-9]+', '-', folded).strip('-')[:28]
    if base in seen:
        n = 2
        while f'{base}-{n}' in seen:
            n += 1
        base = f'{base}-{n}'
    seen.add(base)
    return base


def load_noxh(con):
    path = os.path.join(OUT_DIR, 'noxh-source.csv')
    if not os.path.exists(path):
        raise SystemExit(f'Thiếu {path}')
    with open(path, encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle))
    con.execute('CREATE TABLE noxh_raw (i INTEGER, phase VARCHAR, wkt VARCHAR)')
    payload = []
    for i, row in enumerate(rows):
        phase = (row.get('trang_thai') or '').strip()
        if phase not in ('hien_trang', 'quy_hoach'):
            raise SystemExit(f'Dòng {i + 2} có trang_thai lạ: {phase}')
        wkt = (row.get('WKT_simplified') or '').strip()
        if not wkt.upper().startswith('POLYGON'):
            raise SystemExit(f'Dòng {i + 2} thiếu polygon')
        payload.append((i, phase, wkt))
    con.executemany('INSERT INTO noxh_raw VALUES (?, ?, ?)', payload)
    con.execute("""
        CREATE TABLE noxh AS
        SELECT i, phase, ST_MakeValid(ST_SetCRS(ST_GeomFromText(wkt), 'EPSG:4326')) AS geom
        FROM noxh_raw
    """)
    located = con.execute("""
        SELECT i, name, x, y, gj FROM (
            SELECT n.i, w.name,
                   ST_X(ST_PointOnSurface(n.geom)) AS x,
                   ST_Y(ST_PointOnSurface(n.geom)) AS y,
                   ST_AsGeoJSON(n.geom) AS gj,
                   row_number() OVER (PARTITION BY n.i ORDER BY w.name) AS rn
            FROM noxh n
            LEFT JOIN wards w ON ST_Intersects(w.geom, ST_PointOnSurface(n.geom))
        ) WHERE rn = 1
    """).fetchall()
    loc = {r[0]: r[1:] for r in located}
    hits = con.execute("""
        SELECT n.i, b.id, b.area_m2, b.ward
        FROM noxh n
        JOIN bldg b ON n.phase = 'hien_trang'
         AND ST_Intersects(n.geom, ST_SetCRS(ST_Point(b.x, b.y), 'EPSG:4326'))
    """).fetchall()
    by_i = {}
    used = set()
    for i, bid, area, ward in hits:
        used.add(bid)
        rec = by_i.setdefault(i, {'area': 0.0, 'n': 0, 'wards': {}})
        rec['area'] += float(area or 0)
        rec['n'] += 1
        rec['wards'][ward] = rec['wards'].get(ward, 0.0) + float(area or 0)
    seen = set(KNOWN_ID.values())
    candidates = []
    plan = []
    for i, row in enumerate(rows):
        name = (row.get('ten') or '').strip()
        phase = (row.get('trang_thai') or '').strip()
        info = loc.get(i)
        if not info:
            log(f'không định vị được {name}')
            continue
        ward, lng, lat, gj = info
        ward = ward or ''
        geom = json.loads(gj) if gj else None
        uncertain = uncertain_row(row)
        area_ha = fnum(row.get('dien_tich_ha'))
        floors = fnum(row.get('tang'))
        units = fnum(row.get('so_can'))
        residents = fnum(row.get('dan_so'))
        floors_i = int(floors) if floors and floors > 0 else None
        units_i = int(round(units)) if units and units > 0 else None
        residents_i = int(round(residents)) if residents and residents > 0 else None
        pid = KNOWN_ID.get(name) or plan_id(name, seen)
        point = {
            'id': pid,
            'name': name[:120],
            'lat': round(float(lat), 6),
            'lng': round(float(lng), 6),
            'ward': ward,
            'floors': floors_i,
            'siteHa': area_ha,
            'detail': (row.get('mo_ta') or '').strip(),
            'uncertain': uncertain,
            'geometry': geom,
            'status': phase,
        }
        if phase == 'quy_hoach':
            plan.append({
                **point,
                'units': units_i,
                'plannedPop': residents_i,
            })
            continue
        use_units = None if uncertain else units_i
        use_residents = None if uncertain else residents_i
        foot = by_i.get(i) or {}
        if foot.get('wards'):
            log(f"{pid}: {foot['n']} dấu chân trong ranh, {round(foot['area'])} m², {foot['wards']}")
        candidates.append({
            **point,
            'units': use_units,
            'residents': use_residents,
            'footprint': round(foot['area']) if foot.get('area') else None,
            'signals': {'noxh'},
            'source': 'noxh',
            'members': 1,
        })
    log(f'NOXH hiện trạng {len(candidates)}, quy hoạch {len(plan)}, dấu chân trả về nhà thấp tầng trừ {len(used)}')
    return candidates, used, plan


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

    log('danh sách nhà ở xã hội')
    candidates, used_tall, plan_items = load_noxh(con)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'noxh-plan.json'), 'w', encoding='utf-8') as handle:
        json.dump({
            'v': 1,
            'note': 'Nhà ở xã hội chưa hoàn thành. Không tính vào dân hiện trạng. Chung cư thương mại thêm ở tab Chung cư hoặc giữ trong apartments.json với source sheet, manual hoặc thuongmai.',
            'items': plan_items
        }, handle, ensure_ascii=False, separators=(',', ':'))
    log(f'hiện trạng {len(candidates)}, quy hoạch {len(plan_items)}')


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
        people, how = pop_of(c['floors'], c['units'], c['residents'], c['footprint'])
        if how == 'dan':
            evidence = 'Danh sách nhà ở xã hội đã hoàn thành, có dân số.'
        elif how == 'can':
            evidence = 'Danh sách nhà ở xã hội đã hoàn thành. Bảng không có dân số, tính số căn × 3,3 người/hộ.'
        else:
            evidence = 'Danh sách nhà ở xã hội đã hoàn thành. Chưa có dân số và số căn.'
        items.append({
            'id': c['id'],
            'name': c['name'],
            'lat': round(float(c['lat']), 6),
            'lng': round(float(c['lng']), 6),
            'ward': c['ward'],
            'floors': c['floors'],
            'units': c['units'],
            'residents': c['residents'],
            'footprint': c['footprint'],
            'siteHa': c.get('siteHa'),
            'detail': c.get('detail') or '',
            'uncertain': bool(c.get('uncertain')),
            'geometry': c.get('geometry'),
            'elev': None if not math.isfinite(float(elev[i])) else int(bins[i]),
            'school': bool(catch['school'][i]),
            'health': bool(catch['health'][i]),
            'park': bool(catch['park'][i]),
            'schoolX': bool(catch['schoolX'][i]),
            'healthX': bool(catch['healthX'][i]),
            'parkX': bool(catch['parkX'][i]),
            'source': c['source'],
            'status': 'hien_trang',
            'confidence': 'high',
            'verified': True,
            'evidence': evidence,
            'signals': sorted(c['signals']),
            'pop': round(people),
            'how': how
        })

    # Chỉ dấu chân nằm trong ranh NOXH đã hoàn thành rời khỏi nhà thấp tầng.
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
    log(f'bỏ {int((~keep).sum())} dấu chân trong ranh NOXH đã hoàn thành')
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

    old_path = os.path.join(OUT_DIR, 'apartments.json')
    if os.path.exists(old_path):
        try:
            old_items = json.load(open(old_path, encoding='utf-8')).get('items') or []
        except (OSError, json.JSONDecodeError):
            old_items = []
        have = {it['id'] for it in items}
        kept = []
        for it in old_items:
            if it.get('source') not in KEEP_SOURCE or it.get('status') == 'quy_hoach' or it.get('id') in have:
                continue
            people, how = pop_of(it.get('floors'), it.get('units'), it.get('residents'), it.get('footprint'))
            it['pop'] = round(people)
            it['how'] = how
            it['status'] = it.get('status') or 'hien_trang'
            kept.append(it)
        if kept:
            log(f'giữ {len(kept)} chung cư bổ sung (sheet/manual)')
            items.extend(kept)

    ward_names = sorted(set(bward.tolist()) | set(c['ward'] for c in items if c.get('ward')))
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

    items.sort(key=lambda it: (-it['pop'], it['ward'], it['id']))

    pack = {
        'v': 2,
        'hhSize': HH,
        'm2PerPerson': M2_PERSON,
        'efficiency': EFF,
        'note': 'Hiện trạng chỉ gồm nhà ở xã hội đã hoàn thành. Thêm chung cư thương mại ở tab Chung cư, hoặc trong file này với source sheet, manual hoặc thuongmai — lần chạy script sau giữ các dòng đó.',
        'items': items
    }
    weights = {
        'v': 1,
        'dem': 'Copernicus GLO-30',
        'floodM': FLOOD_M,
        'note': 'Trọng số nhà thấp tầng = diện tích dấu chân nhà ở × (bậc tương đối + 1), đã bỏ dấu chân nằm trong ranh nhà ở xã hội đã hoàn thành. Khu quy hoạch không trừ. Dân pixel cũ là WorldPop 2020 chia đều trong phường, chỉ để so sánh.',
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
            'a': f"{apt_best['name']}: khoảng {vn_int(apt_best['aptPop'])} người trong {apt_best['apt']} chung cư hiện trạng.",
            'wards': [apt_best['name']],
            'source': 'Nhà ở xã hội đã hoàn thành. Có dân số thì dùng dân số, không thì số căn × 3,3.'
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
        f'- Chung cư hiện trạng: **{len(items)}** (cao {by_conf.get("high", 0)}, vừa {by_conf.get("medium", 0)}, thấp {by_conf.get("low", 0)}).',
        f'- Đã xác minh: **{verified}**. Có số dân: **{estimated}**. Chưa đủ số để tính dân: **{missing}**.',
        f'- Dân chung cư toàn thành phố: **{vn_int(city_apt)}** / dân số hành chính **{vn_int(city_pop)}**.',
        f'- Phường bị trừ về 0 vì chung cư vượt dân số: **{len(warns)}**.',
        f'- Dân dưới 5 m: mới **{vn_int(city_flood)}**, pixel WorldPop **{vn_int(city_old_flood)}**.',
        '',
        'Dân chung cư hiện trạng: dân số trong bảng nếu có, không thì số căn × 3,3 người/hộ. Nhà ở xã hội chưa hoàn thành không trừ. Phần còn lại của phường chia cho nhà thấp tầng theo diện tích dấu chân × bậc chiều cao tương đối.',
        '',
        'Chung cư hiện trạng:',
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
