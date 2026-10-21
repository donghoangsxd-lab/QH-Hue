#!/usr/bin/env python3
# Nhãn lô: nghĩa trang luôn non, đài tưởng niệm giữ nhãn file.
import importlib.util
import os

spec = importlib.util.spec_from_file_location(
    'gba_residential',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gba-residential.py')
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def check(cond, msg):
    if not cond:
        raise SystemExit(msg)


check(mod.classify_lot('Đất ở', 'Nghĩa trang Phan Bội Châu', 'res') == 'non', 'Phan Bội Châu phải là non')
check(mod.classify_lot('Đất nghĩa trang', '', 'non') == 'non', 'layer nghĩa trang là non')
check(mod.classify_lot('Đất ở', 'Nhà ở mới', 'res') == 'res', 'đất ở thường giữ res')
check(mod.classify_lot('Đất giao thông', '', 'non') == 'non', 'giao thông giữ non')
check(
    mod.classify_lot('Đất công trình công cộng', 'Đài tưởng niệm nghĩa trang liệt sỹ xã', 'non') == 'non',
    'đài tưởng niệm giữ nhãn file'
)
check(mod.classify_lot('Đất ở', 'Đài tưởng niệm nghĩa trang', 'res') == 'res', 'tưởng niệm không bị ép non')
print('ok')
