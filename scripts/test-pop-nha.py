#!/usr/bin/env python3
"""Bảng điểm dân nhà ở: đúng cột, đúng số dòng, tổng người khớp manifest."""
import gzip
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'public/data/gba/pop-nha.json').read_text(encoding='utf-8'))
assert manifest['rows'] == 663487
assert abs(float(manifest['people']) - 1452683) < 1
assert manifest['droppedNtd'] == 47
assert manifest['gcs'] == 'gba/pop-weights.csv'
assert manifest['asset'].endswith('Pixel-danso-nha')

gz = root / 'public/data/gba/pop-weights.csv.gz'
with gzip.open(gz, 'rt', encoding='utf-8') as handle:
    header = handle.readline().strip()
    rows = sum(1 for _ in handle)
assert header == 'longitude,latitude,people', header
assert rows == manifest['rows']
print('ok', rows)
