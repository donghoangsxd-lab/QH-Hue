#!/usr/bin/env python3
# Ghép lại dấu chân NTD từ archive/gba/ntd-footprints.jsonl.gz vào jsonl đã gỡ,
# rồi dựng lại PMTiles. Không nạp kho lưu vào app.
# Cần bản jsonl đã gỡ (mặc định /tmp/gba/buildings.jsonl sau drop-ntd-footprints.py).
# Máy mới không có file đó thì không dựng lại được PMTiles; kho lưu chỉ chứa phần đã gỡ.
# Nếu còn /tmp/gba/buildings.jsonl.before-ntd và bldg-hf.bin.before-ntd thì dùng lại bản gốc.
#   python3 scripts/restore-ntd-footprints.py
# Đẩy bucket (không chạy ở đây):
#   gcloud storage cp public/data/gba/buildings.pmtiles gs://hue-infra-data-us/gba/buildings.pmtiles

import gzip
import json
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('GBA_TMP', '/tmp/gba')
ARCHIVE = os.path.join(ROOT, 'archive', 'gba', 'ntd-footprints.jsonl.gz')
JSONL = os.path.join(TMP, 'buildings.jsonl')
BEFORE = JSONL + '.before-ntd'
PMT = os.path.join(ROOT, 'public', 'data', 'gba', 'buildings.pmtiles')
BIN = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.bin')
AGG = os.path.join(ROOT, 'public', 'data', 'gba', 'agg.json')
MASK = os.path.join(ROOT, 'public', 'data', 'gba', 'cemetery-mask.geojson')
MISSING = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-missing.geojson')
HF = os.path.join(ROOT, 'public', 'data', 'gba', 'bldg-hf.json')


def originals():
    names = {
        BIN: os.path.join(TMP, 'bldg-hf.bin.before-ntd'),
        HF: os.path.join(TMP, 'bldg-hf.json.before-ntd'),
        AGG: os.path.join(TMP, 'agg.json.before-ntd'),
        MASK: os.path.join(TMP, 'cemetery-mask.geojson.before-ntd'),
        MISSING: os.path.join(TMP, 'bldg-missing.geojson.before-ntd'),
    }
    if os.path.exists(BEFORE) and all(os.path.exists(path) for path in names.values()):
        return names
    return None


def splice():
    if not os.path.exists(JSONL):
        raise SystemExit(f'thiếu {JSONL} — kho lưu không đủ để dựng lại dấu chân còn giữ')
    removed = {}
    with gzip.open(ARCHIVE, 'rt', encoding='utf-8') as handle:
        first = handle.readline()
        meta = json.loads(first)
        if meta.get('type') != 'meta':
            raise SystemExit('dòng đầu kho lưu không phải meta')
        for line in handle:
            feat = json.loads(line)
            removed[int(feat['id'])] = feat
    out = JSONL + '.restored'
    with open(JSONL, encoding='utf-8') as src, open(out, 'w', encoding='utf-8') as dst:
        index = 0
        for line in src:
            index += 1
            while index in removed:
                feat = removed.pop(index)
                dst.write(json.dumps({
                    'type': 'Feature',
                    'properties': {'c': feat['properties']['c']},
                    'geometry': feat['geometry']
                }, ensure_ascii=False, separators=(',', ':')) + '\n')
                index += 1
            dst.write(line if line.endswith('\n') else line + '\n')
        while index + 1 in removed:
            index += 1
            feat = removed.pop(index)
            dst.write(json.dumps({
                'type': 'Feature',
                'properties': {'c': feat['properties']['c']},
                'geometry': feat['geometry']
            }, ensure_ascii=False, separators=(',', ':')) + '\n')
    if removed:
        raise SystemExit(f'còn {len(removed)} id không ghép được')
    os.replace(out, JSONL)
    return meta


def tiles(jsonl):
    os.makedirs(os.path.join(TMP, 'tip'), exist_ok=True)
    subprocess.check_call([
        'tippecanoe', '-o', PMT, '--force', '--layer=gba',
        '--minimum-zoom=13', '--maximum-zoom=16',
        '--drop-smallest-as-needed', '--extend-zooms-if-still-dropping',
        '--maximum-tile-bytes=2500000', '--no-feature-limit',
        '--simplify-only-low-zooms', '--no-tiny-polygon-reduction-at-maximum-zoom',
        '--include=c', '--attribute-type=c:int', '--read-parallel',
        '--temporary-directory=' + os.path.join(TMP, 'tip'),
        jsonl
    ])


def main():
    if not os.path.exists(ARCHIVE):
        raise SystemExit(f'thiếu {ARCHIVE}')
    backed = originals()
    if backed:
        for dest, src in backed.items():
            shutil.copyfile(src, dest)
        tiles(BEFORE)
        print('đã khôi phục từ bản trước khi gỡ và dựng lại pmtiles')
        return
    meta = splice()
    tiles(JSONL)
    print(f"đã ghép {meta.get('removed')} dấu chân vào jsonl và dựng lại pmtiles")
    print('chiều cao, agg và mặt nạ chỉ khôi phục được khi còn file .before-ntd trong /tmp/gba')


if __name__ == '__main__':
    main()
