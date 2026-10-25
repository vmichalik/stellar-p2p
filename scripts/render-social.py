"""Regenerate the checked-in social card with Pillow and the licensed local font.

This optional authoring tool is not part of the npm build or deployed runtime.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
FONT = ROOT / "app/assets/fonts/manrope.woff2"
image = Image.new("RGB", (1200 * SCALE, 630 * SCALE), "#f7f5ee")
draw = ImageDraw.Draw(image)


def font(size):
    return ImageFont.truetype(str(FONT), size * SCALE)


def text(x, y, copy, size, color="#2d382e"):
    draw.text((x * SCALE, y * SCALE), copy, font=font(size), fill=color)


def box(xy, fill, outline=None, radius=20):
    draw.rounded_rectangle(tuple(v * SCALE for v in xy), radius * SCALE,
                           fill=fill, outline=outline, width=2 * SCALE)


# The overlapping cards match Pactlane's exchange mark.
for x, y in [(65, 54), (80, 61)]:
    draw.rounded_rectangle((x*SCALE, y*SCALE, (x+25)*SCALE, (y+36)*SCALE),
                           radius=5*SCALE, outline="#e76d46", width=2*SCALE)
text(120, 48, "pactlane.", 41)
text(946, 63, "pactlane.io", 21)
text(64, 169, "Trade euros for USDC", 55)
text(64, 244, "on Stellar.", 59)
text(66, 348, "A clearer handoff from payment to release.", 23, "#66705f")

box((788, 181, 1129, 282), "#fffef8", "#dddccf")
text(814, 195, "You pay", 16, "#66705f")
text(814, 223, "€20.00", 32)
text(1022, 234, "EUR", 17, "#66705f")
draw.line((956*SCALE, 299*SCALE, 956*SCALE, 330*SCALE), fill="#e76d46", width=3*SCALE)
draw.line((948*SCALE, 322*SCALE, 956*SCALE, 330*SCALE, 964*SCALE, 322*SCALE), fill="#e76d46", width=3*SCALE)
box((788, 347, 1129, 448), "#fffef8", "#dddccf")
text(814, 361, "You receive", 16, "#66705f")
text(814, 389, "22.00", 32)
text(1022, 400, "USDC", 17, "#66705f")

draw.line((64*SCALE, 513*SCALE, 1136*SCALE, 513*SCALE), fill="#d8dacb", width=SCALE)
box((64, 543, 250, 582), "#f7e2d4", radius=9)
text(79, 550, "Interactive demo", 17, "#834528")
text(281, 551, "Sample payments and simulated settlement", 19, "#66705f")
image.resize((1200, 630), Image.Resampling.LANCZOS).save(
    ROOT / "app/assets/social-preview.png", optimize=True
)
