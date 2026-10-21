#!/usr/bin/env python3
"""Bảng điểm dân nhà ở: đúng cột, đúng số dòng, tổng người khớp manifest."""
import gzip
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'public/data/gba/pop-nha.json').read_text(encoding='utf-8'))
assert manifest['rows'] == 664217
assert abs(float(manifest['people']) - 1452683) < 1
assert manifest['droppedNtd'] == 47
assert manifest['droppedAptFootprints'] == 42

apt = json.loads((root / 'public/data/gba/apartments.json').read_text(encoding='utf-8'))
assert len(apt['items']) == 4
assert all(it['status'] == 'hien_trang' and it['ward'] == 'Phường Vỹ Dạ' for it in apt['items'])
assert sum(it['pop'] for it in apt['items']) == 6251
plan = json.loads((root / 'public/data/gba/noxh-plan.json').read_text(encoding='utf-8'))
assert len(plan['items']) == 17
assert sum(1 for it in plan['items'] if it.get('uncertain')) == 2
assert all(it['status'] == 'quy_hoach' for it in plan['items'])
assert manifest['gcs'] == 'gba/pop-weights.csv'
assert manifest['asset'].endswith('Pixel-danso-nha')

gz = root / 'public/data/gba/pop-weights.csv.gz'
with gzip.open(gz, 'rt', encoding='utf-8') as handle:
    header = handle.readline().strip()
    rows = sum(1 for _ in handle)
assert header == 'longitude,latitude,people', header
assert rows == manifest['rows']
print('ok', rows)
