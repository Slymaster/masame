#!/usr/bin/env python3
# Build the kaya board-top textures from ambientCG Wood095 (CC0, 2K or 4K JPG): three straight-grain strips of the clean
# lower half, stacked across the grain (seams run parallel to the fibres, where they read as growth lines), graded to
# pale golden kaya. Writes kaya_{diff,nor,rough}.jpg from the 2K scan, kaya_{diff,nor,rough}_4k.jpg from the 4K one.
# Usage: python3 scripts/kaya-textures.py <ambientCG Wood095 dir> <out dir> [--patina P]   (needs numpy + Pillow)
import argparse, glob, os, numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--patina', type=float, default=0, help='roughness x (1 - P*w), w = 1 within 80 mm of the centre, 0 beyond 220 mm')
a = ap.parse_args()
res = lambda m: glob.glob(os.path.join(a.src, f'Wood095_*-JPG_{m}.jpg'))[0]
col = np.asarray(Image.open(res('Color')).convert('RGB'))
nor = np.asarray(Image.open(res('NormalGL')).convert('RGB'))
W = col.shape[1]; suffix = {2048: '', 4096: '_4k'}[W]; k = W // 2048
Y0, H, F = 420 * k, 604 * k, 40 * k        # clean band rows, band height, feather (px, at 2K x k)
SH = [0, 731 * k, 1390 * k]                # x rolls per strip (the scan tiles horizontally, so rolls are seamless along the grain)

def stack(a, normal=False):
    strips = [np.roll(a[Y0:Y0 + H], s, axis=1).astype(np.float32) for s in SH]
    strips[1] = strips[1][:, ::-1].copy()  # mirror the middle strip along the grain: hides the repeat
    if normal: strips[1][..., 0] = 255 - strips[1][..., 0]  # mirrored tangent-space X
    outH = H * 3 - F * 2; o = np.zeros((outH,) + a.shape[1:], np.float32); w = np.zeros((outH, 1) + (1,) * (a.ndim - 2), np.float32)
    for i, s in enumerate(strips):
        r = np.ones(H, np.float32)
        if i > 0: r[:F] = np.linspace(0, 1, F)
        if i < 2: r[-F:] = np.linspace(1, 0, F)
        r = r.reshape((H, 1) + (1,) * (a.ndim - 2)); y = i * (H - F)
        o[y:y + H] += s * r; w[y:y + H] += r
    return o / w

c = stack(col) / 255.0; n = stack(nor, True)
assert c.shape[:2] == (1732 * k, 2048 * k), c.shape  # Board3D's KAYA_MM = [502, 424.5] assumes this aspect
# grade: lift contrast of the fibres, shift to golden
lin = c ** 2.2
L = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
m = L.mean(); detail = (L - m) / m
base = np.array([0.76, 0.48, 0.18], np.float32)  # linear kaya mid-tone (≈ sRGB 222,188,128)
g = base * np.clip(1 + 1.35 * detail, 0.2, 2.2)[..., None]
# fibres are a touch more saturated/redder than the spring wood
g *= (1 + np.clip(-detail, 0, 1)[..., None] * np.array([0.0, -0.08, -0.22], np.float32))
s = np.clip(g, 0, 1) ** (1 / 2.2)
Image.fromarray((s * 255 + 0.5).astype(np.uint8)).save(f'{a.out}/kaya_diff{suffix}.jpg', quality=88, optimize=True)
nn = n / 255 * 2 - 1; nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
Image.fromarray(((nn * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(f'{a.out}/kaya_nor{suffix}.jpg', quality=90, optimize=True)
# roughness from the fibre detail: open pores a little rougher, polished spring wood smoother (scan roughness is flat)
r = np.clip(0.62 + 0.45 * np.clip(-detail, -0.5, 1.0), 0.35, 1.0)
if a.patina:
    # hands polish the middle of the board: the scan is 502 mm along the grain at any resolution (2048 px = 502 mm), and
    # Board3D maps the image centre to the board centre
    mm = 502 / W; yy, xx = np.indices(r.shape, np.float32)
    d = np.hypot((xx - (W - 1) / 2) * mm, (yy - (r.shape[0] - 1) / 2) * mm)
    t = np.clip((d - 80) / 140, 0, 1); w = 1 - t * t * (3 - 2 * t)
    r = r * (1 - a.patina * w)
Image.fromarray((r * 255).astype(np.uint8)).resize((W // 2, r.shape[0] // 2), Image.LANCZOS).save(f'{a.out}/kaya_rough{suffix}.jpg', quality=90)
print(s.shape, 'detail std', float(detail.std()))
