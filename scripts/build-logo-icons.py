#!/usr/bin/env python3
# Dựng favicon, icon PWA và thẻ og từ logo chủ sở hữu (Ngọ Môn xanh/trắng).
# Nguồn scripts/assets/logo-hue.png chỉ khoảng 304×308. Cỡ 180 trở xuống là thu nhỏ.
# 192/512 phóng Lanczos khoảng 1,7 lần — không có bản vector.
# Favicon 16–48 cắt riêng phần cổng (bỏ lưới bản đồ phía dưới) để còn đọc được.

import io
import shutil
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'scripts' / 'assets' / 'logo-hue.png'
ICONS = ROOT / 'public' / 'icons'

BLUE = (43, 85, 120, 255)       # #2B5578, xanh đặc trong logo
CREAM = (242, 239, 229, 255)    # #F2EFE5
SLATE = (15, 23, 42, 255)       # #0f172a, nền app
# Phần cổng, bỏ lưới bản đồ. Đo trên file nguồn 304×308.
GATE_BOX = (36, 28, 268, 200)
FONT = '/usr/share/fonts/truetype/macos/Inter-Bold.ttf'
TITLE = 'Bản đồ Quy hoạch đô thị - TP Huế'


def square_pad(im, color):
    w, h = im.size
    side = max(w, h)
    canvas = Image.new('RGBA', (side, side), color)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas


def fit(im, size, color):
    base = square_pad(im, color)
    return base.resize((size, size), Image.Resampling.LANCZOS)


def gate_master(im):
    crop = im.crop(GATE_BOX)
    return square_pad(crop, CREAM)


def poster(im, size):
    small = im.resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', (size, size), CREAM)
    src = small.load()
    dst = out.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = src[x, y]
            dst[x, y] = BLUE if (b > r + 8 and r < 180) else CREAM
    return out


def maskable(im, size):
    # Vùng an toàn maskable là 80% giữa. Phần bị cắt là nền xanh của logo.
    canvas = Image.new('RGBA', (size, size), BLUE)
    inner = int(round(size * 0.80))
    mark = fit(im, inner, CREAM)
    offset = (size - inner) // 2
    canvas.paste(mark, (offset, offset), mark)
    return canvas


def save_png(im, path):
    im.convert('RGB').save(path, format='PNG', optimize=True)


def save_ico(path, images):
    # PNG bên trong ICO để giữ đúng từng cỡ (16 đã poster, 32/48 Lanczos).
    blobs = []
    for im in images:
        buf = io.BytesIO()
        im.convert('RGBA').save(buf, format='PNG')
        blobs.append(buf.getvalue())
    with path.open('wb') as handle:
        handle.write(struct.pack('<HHH', 0, 1, len(blobs)))
        offset = 6 + 16 * len(blobs)
        for im, blob in zip(images, blobs):
            w = 0 if im.width >= 256 else im.width
            h = 0 if im.height >= 256 else im.height
            handle.write(struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(blob), offset))
            offset += len(blob)
        for blob in blobs:
            handle.write(blob)


def og_card(logo):
    card = Image.new('RGB', (1200, 630), SLATE[:3])
    mark = fit(logo, 292, CREAM).convert('RGB')
    draw = ImageDraw.Draw(card)
    font = ImageFont.truetype(FONT, 58)
    bbox = draw.textbbox((0, 0), TITLE, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    gap = 36
    block = 292 + gap + th
    top = (630 - block) // 2
    card.paste(mark, ((1200 - 292) // 2, top))
    x = (1200 - tw) // 2 - bbox[0]
    y = top + 292 + gap - bbox[1]
    draw.text((x, y), TITLE, font=font, fill=CREAM[:3])
    return card


def main():
    src = Image.open(SRC).convert('RGBA')
    if src.size != (304, 308):
        raise SystemExit(f'nguồn logo đổi kích thước: {src.size}')
    ICONS.mkdir(parents=True, exist_ok=True)
    gate = gate_master(src)

    fav16 = poster(gate, 16)
    fav32 = fit(gate, 32, CREAM)
    fav48 = fit(gate, 48, CREAM)
    save_png(fav16, ICONS / 'favicon-16.png')
    save_png(fav32, ICONS / 'favicon-32.png')
    save_ico(ICONS / 'favicon.ico', [fav16, fav32, fav48])
    shutil.copyfile(ICONS / 'favicon.ico', ROOT / 'public' / 'favicon.ico')

    save_png(fit(src, 180, CREAM), ICONS / 'apple-touch-icon.png')
    icon192 = fit(src, 192, CREAM)
    icon512 = fit(src, 512, CREAM)
    save_png(icon192, ICONS / 'icon-192.png')
    save_png(icon512, ICONS / 'icon-512.png')
    save_png(icon192, ICONS / 'pwa-192.png')
    save_png(maskable(src, 192), ICONS / 'icon-maskable-192.png')
    save_png(maskable(src, 512), ICONS / 'icon-maskable-512.png')
    og_card(src).save(ICONS / 'og.png', format='PNG', optimize=True)

    svg = ICONS / 'favicon.svg'
    if svg.exists():
        svg.unlink()
    print('icons ok', SRC.stat().st_size, 'source bytes')


if __name__ == '__main__':
    main()
