"""Cuts assets/chips.png out of the root chips.png.

No rembg/cv2/scipy available in this environment, and per-pixel matting
attempts (adaptive flood fill, local-variance/Laplacian smoothness maps)
kept leaving a visible ring of the source's radial vignette because that
glow is nearly as textured as the chips at the resolution available here.
The vignette is a clean radial gradient centered on the frame though, so
a matched elliptical soft-edge mask removes the black corners and the
glow ring directly and predictably, at the cost of a very slight, evenly
soft-feathered edge on the chip pile itself — a fine trade for a game
texture rendered small on a leaf.
"""
from PIL import Image
import numpy as np

SRC = 'chips.png'
OUT = 'assets/chips.png'

R_IN = 0.50   # fully opaque inside this fraction of the half-dimension
R_OUT = 0.72  # fully transparent beyond this fraction

im = Image.open(SRC).convert('RGB')
W, H = im.size
cx, cy = W / 2.0, H / 2.0
rx, ry = W / 2.0, H / 2.0

yy, xx = np.mgrid[0:H, 0:W]
r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)

t = np.clip((r - R_IN) / (R_OUT - R_IN), 0, 1)
alpha = (1 - (3 * t ** 2 - 2 * t ** 3))  # smoothstep falloff

if W >= H:
    newW = 900
    newH = round(H * 900 / W)
else:
    newH = 900
    newW = round(W * 900 / H)

# Premultiply before resizing so LANCZOS doesn't blend transparent-region
# background color into the visible edge (straight-alpha resize fringes).
rgb = np.asarray(im).astype(np.float32)
premult = rgb * alpha[:, :, None]
premult_img = Image.fromarray(premult.astype(np.uint8), mode='RGB').resize((newW, newH), Image.LANCZOS)
alpha_img = Image.fromarray((alpha * 255).astype(np.uint8), mode='L').resize((newW, newH), Image.LANCZOS)

premult_r = np.asarray(premult_img).astype(np.float32)
alpha_r = np.asarray(alpha_img).astype(np.float32)
safe_a = np.clip(alpha_r, 1, 255)
rgb_r = np.clip(premult_r / (safe_a[:, :, None] / 255.0), 0, 255).astype(np.uint8)

from PIL import ImageFilter
alpha_soft = Image.fromarray(alpha_r.astype(np.uint8), mode='L').filter(ImageFilter.GaussianBlur(1.5))
out = Image.fromarray(rgb_r, mode='RGB').convert('RGBA')
out.putalpha(alpha_soft)

bbox = out.getbbox()
if bbox:
    l, t2, r2, b = bbox
    pad = 6
    l = max(0, l - pad); t2 = max(0, t2 - pad)
    r2 = min(newW, r2 + pad); b = min(newH, b + pad)
    out = out.crop((l, t2, r2, b))

out.save(OUT)
print('saved', OUT, out.size)
