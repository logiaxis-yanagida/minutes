"""議事録アプリのアイコン（ティール背景＋白い書類）を生成する。

使い方: python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

BG = (15, 118, 110, 255)
FG = (255, 255, 255, 255)
BASE = 512
SS = 4
CORNER_RADIUS = 112
STROKE = 32

ICON_DIR = Path(__file__).resolve().parent.parent / "icons"


def draw_round_line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], width: float) -> None:
    r = width / 2
    for a, b in zip(points, points[1:]):
        draw.line([a, b], fill=FG, width=round(width))
    for x, y in points:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=FG)


def draw_document(draw: ImageDraw.ImageDraw, size: int, scale: float) -> None:
    u = size / BASE * scale
    cx = cy = size / 2
    w, h, fold = 224 * u, 300 * u, 64 * u
    stroke = STROKE * size / BASE * scale
    left, right = cx - w / 2, cx + w / 2
    top, bottom = cy - h / 2, cy + h / 2

    outline = [
        (left, top),
        (right - fold, top),
        (right, top + fold),
        (right, bottom),
        (left, bottom),
        (left, top),
    ]
    draw_round_line(draw, outline, stroke)
    corner = [(right - fold, top), (right - fold, top + fold), (right, top + fold)]
    draw.polygon(corner, fill=FG)
    draw_round_line(draw, corner, stroke)

    line_left = left + 50 * u
    line_right = right - 50 * u
    for i, y in enumerate((cy - 16 * u, cy + 36 * u, cy + 88 * u)):
        end = line_left + (line_right - line_left) * 0.6 if i == 2 else line_right
        draw_round_line(draw, [(line_left, y), (end, y)], stroke)


def render(size: int, *, rounded: bool, scale: float, mode: str) -> Image.Image:
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if rounded:
        r = CORNER_RADIUS * big / BASE
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=r, fill=BG)
    else:
        draw.rectangle((0, 0, big, big), fill=BG)
    draw_document(draw, big, scale)
    out = img.resize((size, size), Image.LANCZOS)
    if mode == "RGB":
        rgb = Image.new("RGB", (size, size), BG[:3])
        rgb.paste(out, mask=out.split()[3])
        return rgb
    return out


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    render(192, rounded=True, scale=1.0, mode="RGBA").save(ICON_DIR / "icon-192.png")
    render(512, rounded=True, scale=1.0, mode="RGBA").save(ICON_DIR / "icon-512.png")
    render(512, rounded=False, scale=0.9, mode="RGBA").save(ICON_DIR / "icon-maskable-512.png")
    render(180, rounded=False, scale=1.0, mode="RGB").save(ICON_DIR / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
