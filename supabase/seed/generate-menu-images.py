#!/usr/bin/env python3
"""Generates the Demo sample menu images (abstract illustrated plates/cups, 480x320 PNG, no third-party code or photos).
Pure standard library. Output: supabase/seed/menu-images/<orgId>/items/<itemId>/sample.png
Everything produced here is dedicated to the public domain under CC0 1.0 (see README.md)."""
import math, os, struct, zlib

W, H = 480, 320
ORG = "de000000-0000-4000-8000-000000000001"
ITEMS = {  # item id -> (background top, background bottom, food colour, accent colour, kind)
    "de000000-0000-4000-8000-000000000501": ((255, 236, 200), (244, 196, 130), (214, 150, 60), (120, 170, 70), "plate"),   # Nasi Goreng
    "de000000-0000-4000-8000-000000000502": ((255, 230, 190), (236, 180, 120), (230, 170, 70), (200, 60, 50), "plate"),    # Mie Goreng
    "de000000-0000-4000-8000-000000000503": ((250, 215, 190), (225, 150, 110), (150, 70, 40), (70, 140, 70), "plate"),     # Ayam Bakar
    "de000000-0000-4000-8000-000000000504": ((214, 236, 240), (160, 205, 215), (190, 110, 40), (255, 255, 255), "glass"),  # Es Teh
    "de000000-0000-4000-8000-000000000505": ((236, 222, 205), (200, 175, 150), (110, 70, 45), (245, 235, 220), "glass"),   # Kopi Susu
    "de000000-0000-4000-8000-000000000506": ((226, 240, 220), (170, 210, 160), (240, 240, 235), (90, 140, 70), "glass"),   # Es Cendol
}

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def render(top, bottom, food, accent, kind):
    px = [[lerp(top, bottom, y / (H - 1)) for _ in range(W)] for y in range(H)]
    def disc(cx, cy, r, color, ry=None):
        ry = ry or r
        for y in range(max(0, int(cy - ry)), min(H, int(cy + ry) + 1)):
            for x in range(max(0, int(cx - r)), min(W, int(cx + r) + 1)):
                if ((x - cx) / r) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                    px[y][x] = color
    def rect(x0, y0, x1, y1, color):
        for y in range(max(0, y0), min(H, y1)):
            for x in range(max(0, x0), min(W, x1)):
                px[y][x] = color
    if kind == "plate":
        disc(240, 190, 150, (60, 50, 45), 96)         # shadow
        disc(240, 180, 150, (250, 250, 250), 96)      # plate
        disc(240, 178, 118, (236, 236, 236), 74)      # rim
        disc(240, 172, 92, food, 56)                  # food
        for i in range(9):                            # garnish
            a = i * 2 * math.pi / 9
            disc(240 + 60 * math.cos(a), 172 + 34 * math.sin(a), 9, accent)
    else:
        rect(176, 60, 304, 268, (255, 255, 255))      # glass
        rect(184, 100, 296, 260, food)                # drink
        rect(184, 100, 296, 124, accent)              # foam / topping
        disc(240, 266, 64, (60, 50, 45), 12)          # shadow
        rect(280, 20, 292, 130, (210, 60, 60))        # straw
    return px

def png(px):
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in px)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

here = os.path.dirname(os.path.abspath(__file__))
for item_id, spec in ITEMS.items():
    out = os.path.join(here, "menu-images", ORG, "items", item_id)
    os.makedirs(out, exist_ok=True)
    data = png(render(*spec))
    open(os.path.join(out, "sample.png"), "wb").write(data)
    print(item_id, len(data), "bytes")
