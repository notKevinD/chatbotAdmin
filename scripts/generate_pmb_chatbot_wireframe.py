from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "wireframe-pmb-chatbot.png"


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for item in candidates:
        if item.exists():
            return ImageFont.truetype(str(item), size)
    return ImageFont.load_default()


TITLE = font(42, True)
SUBTITLE = font(23)
SECTION = font(28, True)
LABEL = font(20, True)
TEXT = font(19)
SMALL = font(16)


COLORS = {
    "bg": "#f3f4f6",
    "paper": "#ffffff",
    "line": "#9ca3af",
    "line_dark": "#4b5563",
    "text": "#111827",
    "muted": "#6b7280",
    "soft": "#e5e7eb",
    "soft2": "#f9fafb",
    "accent": "#d1d5db",
}


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def centered(draw, xy, text, fnt, fill=None):
    x1, y1, x2, y2 = xy
    tw, th = text_size(draw, text, fnt)
    draw.text((x1 + (x2 - x1 - tw) / 2, y1 + (y2 - y1 - th) / 2 - 2), text, font=fnt, fill=fill or COLORS["text"])


def rect(draw, xy, label="", sub="", fill=None, outline=None, width=2, radius=12):
    fill = fill or COLORS["paper"]
    outline = outline or COLORS["line"]
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    x1, y1, x2, y2 = xy
    if label:
        draw.text((x1 + 18, y1 + 14), label, font=LABEL, fill=COLORS["text"])
    if sub:
        draw.text((x1 + 18, y1 + 42), sub, font=TEXT, fill=COLORS["muted"])


def pill(draw, xy, text, fill=None, outline=None):
    draw.rounded_rectangle(xy, radius=24, fill=fill or COLORS["soft2"], outline=outline or COLORS["line"], width=2)
    centered(draw, xy, text, TEXT, COLORS["text"])


def arrow(draw, start, end):
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=COLORS["line_dark"], width=3)
    import math

    angle = math.atan2(y2 - y1, x2 - x1)
    size = 12
    p1 = (x2 - size * math.cos(angle - 0.5), y2 - size * math.sin(angle - 0.5))
    p2 = (x2 - size * math.cos(angle + 0.5), y2 - size * math.sin(angle + 0.5))
    draw.polygon([(x2, y2), p1, p2], fill=COLORS["line_dark"])


def browser_frame(draw, xy, title):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=22, fill=COLORS["paper"], outline=COLORS["line_dark"], width=3)
    draw.rounded_rectangle((x1, y1, x2, y1 + 56), radius=22, fill=COLORS["soft"], outline=COLORS["line_dark"], width=3)
    draw.rectangle((x1, y1 + 28, x2, y1 + 56), fill=COLORS["soft"])
    for i, color in enumerate(["#d1d5db", "#cbd5e1", "#e5e7eb"]):
        draw.ellipse((x1 + 24 + i * 28, y1 + 20, x1 + 40 + i * 28, y1 + 36), fill=color, outline=COLORS["line"])
    draw.text((x1 + 120, y1 + 16), title, font=TEXT, fill=COLORS["muted"])


def draw_closed_state(draw, xy):
    x1, y1, x2, y2 = xy
    browser_frame(draw, xy, "Halaman PMB UBL dengan tombol chatbot")
    top = y1 + 56

    rect(draw, (x1 + 28, top + 24, x2 - 28, top + 94), fill=COLORS["soft2"], radius=10)
    draw.rectangle((x1 + 48, top + 44, x1 + 92, top + 74), fill=COLORS["accent"], outline=COLORS["line"])
    draw.text((x1 + 108, top + 38), "UBL PMB 2026", font=LABEL, fill=COLORS["text"])
    nav_x = x2 - 600
    for i, item in enumerate(["Beranda", "Program Studi", "Beasiswa", "Kontak"]):
        draw.text((nav_x + i * 112, top + 42), item, font=SMALL, fill=COLORS["muted"])
    pill(draw, (x2 - 190, top + 34, x2 - 56, top + 82), "Daftar")

    hero_y = top + 138
    pill(draw, (x1 + 56, hero_y, x1 + 430, hero_y + 48), "Status pendaftaran aktif")
    draw.rectangle((x1 + 56, hero_y + 92, x1 + 500, hero_y + 130), fill=COLORS["line_dark"])
    draw.rectangle((x1 + 56, hero_y + 148, x1 + 430, hero_y + 186), fill=COLORS["line_dark"])
    draw.rectangle((x1 + 56, hero_y + 204, x1 + 500, hero_y + 242), fill=COLORS["line_dark"])
    for i, w in enumerate([470, 430, 500]):
        draw.rectangle((x1 + 56, hero_y + 292 + i * 34, x1 + 56 + w, hero_y + 312 + i * 34), fill=COLORS["accent"])
    pill(draw, (x1 + 56, hero_y + 430, x1 + 240, hero_y + 486), "Daftar Sekarang")
    pill(draw, (x1 + 270, hero_y + 430, x1 + 480, hero_y + 486), "Lihat Program")

    card_x = x1 + 610
    rect(draw, (card_x, hero_y + 60, x2 - 64, hero_y + 250), "Kartu Informasi PMB", "Tahun akademik dan status PMB")
    for i, label in enumerate(["Prodi", "Mahasiswa", "Akreditasi"]):
        bx = card_x + i * 148
        rect(draw, (bx, hero_y + 286, bx + 128, hero_y + 405), label, "Ringkasan", fill=COLORS["soft2"])
    rect(draw, (card_x, hero_y + 440, x2 - 64, hero_y + 560), "Fakultas Tersedia", "Daftar fakultas dalam bentuk label sederhana")

    draw.ellipse((x2 - 126, y2 - 126, x2 - 56, y2 - 56), fill=COLORS["line_dark"], outline=COLORS["text"])
    centered(draw, (x2 - 126, y2 - 126, x2 - 56, y2 - 56), "Chat", SMALL, "#ffffff")


def draw_open_state(draw, xy):
    x1, y1, x2, y2 = xy
    browser_frame(draw, xy, "Halaman PMB UBL dengan panel chatbot terbuka")
    top = y1 + 56

    rect(draw, (x1 + 28, top + 24, x2 - 28, top + 94), fill=COLORS["soft2"], radius=10)
    draw.rectangle((x1 + 48, top + 44, x1 + 92, top + 74), fill=COLORS["accent"], outline=COLORS["line"])
    draw.text((x1 + 108, top + 38), "UBL PMB 2026", font=LABEL, fill=COLORS["text"])

    hero_y = top + 140
    draw.rectangle((x1 + 56, hero_y + 96, x1 + 460, hero_y + 134), fill=COLORS["line_dark"])
    draw.rectangle((x1 + 56, hero_y + 154, x1 + 360, hero_y + 192), fill=COLORS["line_dark"])
    for i, w in enumerate([420, 360, 430]):
        draw.rectangle((x1 + 56, hero_y + 250 + i * 34, x1 + 56 + w, hero_y + 270 + i * 34), fill=COLORS["accent"])

    chat_x = x1 + 540
    chat_y = top + 115
    chat_w = x2 - chat_x - 48
    chat_h = y2 - chat_y - 42
    rect(draw, (chat_x, chat_y, chat_x + chat_w, chat_y + chat_h), fill=COLORS["paper"], outline=COLORS["line_dark"], radius=18)
    draw.rectangle((chat_x, chat_y, chat_x + chat_w, chat_y + 82), fill=COLORS["soft"])
    draw.text((chat_x + 24, chat_y + 18), "Chat Support", font=LABEL, fill=COLORS["text"])
    draw.text((chat_x + 24, chat_y + 48), "Session pengguna", font=SMALL, fill=COLORS["muted"])
    draw.text((chat_x + chat_w - 100, chat_y + 24), "+   x", font=LABEL, fill=COLORS["muted"])

    draw.rounded_rectangle((chat_x + chat_w - 160, chat_y + 116, chat_x + chat_w - 28, chat_y + 172), radius=18, fill=COLORS["line_dark"])
    centered(draw, (chat_x + chat_w - 160, chat_y + 116, chat_x + chat_w - 28, chat_y + 172), "User", TEXT, "#ffffff")
    draw.rounded_rectangle((chat_x + 32, chat_y + 205, chat_x + chat_w - 90, chat_y + 290), radius=20, fill=COLORS["soft2"], outline=COLORS["line"], width=2)
    draw.text((chat_x + 56, chat_y + 226), "Jawaban chatbot PMB", font=TEXT, fill=COLORS["text"])
    draw.text((chat_x + 56, chat_y + 254), "berdasarkan data RAG.", font=TEXT, fill=COLORS["muted"])

    input_y = chat_y + chat_h - 92
    draw.rectangle((chat_x, input_y - 18, chat_x + chat_w, chat_y + chat_h), fill=COLORS["soft2"])
    rect(draw, (chat_x + 32, input_y, chat_x + chat_w - 112, input_y + 58), "Ketik pesan...", fill=COLORS["paper"], outline=COLORS["line"], radius=18)
    draw.ellipse((chat_x + chat_w - 86, input_y, chat_x + chat_w - 28, input_y + 58), fill=COLORS["accent"], outline=COLORS["line"])
    centered(draw, (chat_x + chat_w - 86, input_y, chat_x + chat_w - 28, input_y + 58), "Kirim", SMALL, COLORS["text"])


def main():
    img = Image.new("RGB", (2400, 1500), COLORS["bg"])
    draw = ImageDraw.Draw(img)

    draw.text((70, 48), "Wireframe Antarmuka Website PMB dan Chatbot", font=TITLE, fill=COLORS["text"])
    draw.text((72, 102), "Rancangan sederhana untuk menunjukkan struktur halaman, tombol chatbot, dan tampilan percakapan.", font=SUBTITLE, fill=COLORS["muted"])

    draw.text((78, 170), "A. Kondisi chatbot tertutup", font=SECTION, fill=COLORS["text"])
    draw.text((1240, 170), "B. Kondisi chatbot terbuka", font=SECTION, fill=COLORS["text"])

    draw_closed_state(draw, (70, 220, 1170, 1360))
    draw_open_state(draw, (1230, 220, 2330, 1360))


    draw.text((70, 1410), "Gambar: wireframe antarmuka website PMB UBL dan chatbot berbasis AI Agent dengan RAG.", font=TEXT, fill=COLORS["muted"])
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
