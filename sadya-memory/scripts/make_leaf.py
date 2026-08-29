"""Procedurally draws a bigger, more detailed banana-leaf texture (transparent PNG)
to replace assets/leaf.png. Supersampled + downscaled for clean anti-aliased edges.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)

SS = 4                      # supersample factor
W, H = 1900 * 1, 900 * 1    # final output size
BW, BH = W * SS, H * SS

MARGIN = 40 * SS
LX0, LX1 = MARGIN, BW - MARGIN
LY_MID = BH / 2.0
HALF_W = (LX1 - LX0) / 2.0
CX = (LX0 + LX1) / 2.0

# widest point sits left of center, like a real banana leaf
X0_FRAC = -0.16
MAX_HALF_H = BH * 0.40

def half_width(u):
    """u in [-1,1] (leaf-length axis). Returns half-thickness at that point."""
    x0 = X0_FRAC
    if u <= x0:
        span = x0 - (-1.0)
        t = max(0.0, (u - (-1.0)) / span)
        shape = math.sin(t * math.pi / 2) ** 0.72
    else:
        span = 1.0 - x0
        t = max(0.0, (1.0 - u) / span)
        shape = math.sin(t * math.pi / 2) ** 0.92
    wob = 1.0 + 0.006 * math.sin(u * 18.0 + 0.6) + 0.0025 * math.sin(u * 53.0 + 2.1)
    return MAX_HALF_H * shape * wob

def px(u):
    return CX + u * HALF_W

N = 420
top_pts = []
bot_pts = []
for i in range(N + 1):
    u = -1.0 + 2.0 * i / N
    hw = half_width(u)
    x = px(u)
    top_pts.append((x, LY_MID - hw))
    bot_pts.append((x, LY_MID + hw))

outline = top_pts + bot_pts[::-1]

img = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))

# ---- mask for the leaf silhouette ----
mask = Image.new('L', (BW, BH), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.polygon(outline, fill=255)

# little stem nub at the left tip
stem_x = px(-1.0)
mdraw.polygon([
    (stem_x + 2 * SS, LY_MID - 10 * SS),
    (stem_x - 26 * SS, LY_MID - 4 * SS),
    (stem_x - 26 * SS, LY_MID + 4 * SS),
    (stem_x + 2 * SS, LY_MID + 10 * SS),
], fill=255)

# ---- base color: diagonal gradient, brighter near the rib, deep green at edges ----
base = Image.new('RGB', (BW, BH), (26, 92, 34))
bpix = base.load()
top_c = (150, 205, 70)
mid_c = (58, 140, 46)
edge_c = (16, 66, 26)
for y in range(0, BH, 2):
    row_frac = abs(y - LY_MID) / MAX_HALF_H
    row_frac = min(1.0, row_frac)
    for x in range(0, BW, 2):
        u = (x - CX) / HALF_W
        light = max(0.0, 1.0 - abs(u + 0.1)) * 0.5 + (1.0 - row_frac) * 0.65
        light = min(1.0, light)
        if light > 0.55:
            f = (light - 0.55) / 0.45
            r = int(mid_c[0] + (top_c[0] - mid_c[0]) * f)
            g = int(mid_c[1] + (top_c[1] - mid_c[1]) * f)
            b = int(mid_c[2] + (top_c[2] - mid_c[2]) * f)
        else:
            f = light / 0.55
            r = int(edge_c[0] + (mid_c[0] - edge_c[0]) * f)
            g = int(edge_c[1] + (mid_c[1] - edge_c[1]) * f)
            b = int(edge_c[2] + (mid_c[2] - edge_c[2]) * f)
        for dy in range(2):
            for dx in range(2):
                if x + dx < BW and y + dy < BH:
                    bpix[x + dx, y + dy] = (r, g, b)

img.paste(base, (0, 0))
img.putalpha(mask)

# ---- veins, drawn on their own layer then masked ----
veins = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
vdraw = ImageDraw.Draw(veins)

rib_w = 7 * SS
vdraw.line([(px(-1.0), LY_MID), (px(1.0), LY_MID)], fill=(214, 232, 140, 235), width=rib_w)
vdraw.line([(px(-1.0), LY_MID), (px(1.0), LY_MID)], fill=(255, 255, 255, 90), width=max(1, rib_w // 3))

n_veins = 30
for i in range(1, n_veins):
    u = -0.97 + 1.94 * i / n_veins
    hw = half_width(u)
    if hw < 6 * SS:
        continue
    rx, ry = px(u), LY_MID
    ang = math.radians(58 + 10 * math.sin(u * 3.0))
    for sign in (-1, 1):
        ex = rx + math.cos(ang) * hw * 1.18 * (1 if u < X0_FRAC else 1.05)
        ey = LY_MID + sign * hw * 0.94
        ctrl_x = rx + (ex - rx) * 0.5
        ctrl_y = LY_MID + sign * hw * 0.35
        steps = 14
        line_pts = []
        for s in range(steps + 1):
            t = s / steps
            bx = (1 - t) ** 2 * rx + 2 * (1 - t) * t * ctrl_x + t ** 2 * ex
            by = (1 - t) ** 2 * ry + 2 * (1 - t) * t * ctrl_y + t ** 2 * ey
            line_pts.append((bx, by))
        vw = max(1, int(2.1 * SS - abs(u) * 0.6 * SS))
        vdraw.line(line_pts, fill=(232, 244, 190, 100), width=vw)

img_rgba = img.convert('RGBA')
veins_masked = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
veins_masked.paste(veins, (0, 0), mask=mask)
img_rgba = Image.alpha_composite(img_rgba, veins_masked)

# ---- soft glossy highlight band ----
highlight = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
hdraw = ImageDraw.Draw(highlight)
hl_pts = []
for i in range(0, N + 1, 4):
    u = -1.0 + 2.0 * i / N
    if u < -0.6 or u > 0.75:
        continue
    hw = half_width(u)
    hl_pts.append((px(u), LY_MID - hw * 0.5))
if hl_pts:
    hdraw.line(hl_pts, fill=(255, 255, 255, 95), width=16 * SS, joint='curve')
highlight = highlight.filter(ImageFilter.GaussianBlur(16 * SS))

hl2_pts = []
for i in range(0, N + 1, 4):
    u = -1.0 + 2.0 * i / N
    if u < -0.35 or u > 0.15:
        continue
    hw = half_width(u)
    hl2_pts.append((px(u), LY_MID - hw * 0.15))
if hl2_pts:
    hdraw.line(hl2_pts, fill=(255, 255, 255, 70), width=9 * SS, joint='curve')
highlight_masked = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
highlight_masked.paste(highlight, (0, 0), mask=mask)
img_rgba = Image.alpha_composite(img_rgba, highlight_masked)

# ---- darker rim along the edge for depth ----
rim = Image.new('L', (BW, BH), 0)
rdraw = ImageDraw.Draw(rim)
rdraw.line(outline + [outline[0]], fill=255, width=10 * SS, joint='curve')
rim = rim.filter(ImageFilter.GaussianBlur(6 * SS))
rim_layer = Image.new('RGBA', (BW, BH), (10, 46, 16, 0))
r_alpha = Image.new('L', (BW, BH), 0)
r_alpha.paste(rim, (0, 0))
rim_layer.putalpha(r_alpha.point(lambda v: int(v * 0.55)))
rim_masked = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
rim_masked.paste(rim_layer, (0, 0), mask=mask)
img_rgba = Image.alpha_composite(img_rgba, rim_masked)

final = img_rgba.resize((W, H), Image.LANCZOS)
final.save('assets/leaf.png')
print('saved', final.size)
