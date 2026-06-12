from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "wireframe-admin-chatbot.png"


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
PANEL_TITLE = font(25, True)
LABEL = font(18, True)
TEXT = font(17)
SMALL = font(14)


COLORS = {
    "bg": "#f3f4f6",
    "paper": "#ffffff",
    "soft": "#f9fafb",
    "soft2": "#e5e7eb",
    "line": "#9ca3af",
    "dark": "#374151",
    "text": "#111827",
    "muted": "#6b7280",
    "active": "#dbeafe",
}


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def centered(draw, xy, text, fnt, fill=None):
    x1, y1, x2, y2 = xy
    tw, th = text_size(draw, text, fnt)
    draw.text((x1 + (x2 - x1 - tw) / 2, y1 + (y2 - y1 - th) / 2 - 2), text, font=fnt, fill=fill or COLORS["text"])


def rect(draw, xy, label="", sub="", fill=None, outline=None, width=2, radius=10):
    fill = fill or COLORS["paper"]
    outline = outline or COLORS["line"]
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    x1, y1, _, _ = xy
    if label:
        draw.text((x1 + 14, y1 + 12), label, font=LABEL, fill=COLORS["text"])
    if sub:
        draw.text((x1 + 14, y1 + 38), sub, font=SMALL, fill=COLORS["muted"])


def pill(draw, xy, text, fill=None):
    draw.rounded_rectangle(xy, radius=20, fill=fill or COLORS["soft"], outline=COLORS["line"], width=2)
    centered(draw, xy, text, SMALL, COLORS["text"])


def page_frame(draw, xy, title):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=22, fill=COLORS["paper"], outline=COLORS["dark"], width=3)
    draw.rounded_rectangle((x1, y1, x2, y1 + 48), radius=22, fill=COLORS["soft2"], outline=COLORS["dark"], width=3)
    draw.rectangle((x1, y1 + 25, x2, y1 + 48), fill=COLORS["soft2"])
    for i in range(3):
        draw.ellipse((x1 + 18 + i * 25, y1 + 17, x1 + 32 + i * 25, y1 + 31), fill="#d1d5db", outline=COLORS["line"])
    draw.text((x1 + 100, y1 + 14), title, font=SMALL, fill=COLORS["muted"])


def sidebar(draw, x, y, h, active):
    draw.rectangle((x, y, x + 160, y + h), fill="#eef2f7", outline=COLORS["line"])
    draw.text((x + 18, y + 24), "AI Agent Admin", font=LABEL, fill=COLORS["text"])
    draw.text((x + 18, y + 50), "Admin chatbot PMB", font=SMALL, fill=COLORS["muted"])
    items = ["Dashboard", "Data Chatbot", "Chat"]
    for idx, item in enumerate(items):
        top = y + 105 + idx * 58
        fill = COLORS["active"] if item == active else COLORS["paper"]
        rect(draw, (x + 16, top, x + 144, top + 42), item, fill=fill, radius=8)
    pill(draw, (x + 18, y + h - 58, x + 142, y + h - 22), "Keluar", fill=COLORS["soft2"])


def draw_login(draw, xy):
    x1, y1, x2, y2 = xy
    page_frame(draw, xy, "Halaman Login Admin")
    card_w, card_h = 420, 360
    cx = x1 + (x2 - x1 - card_w) // 2
    cy = y1 + 140
    rect(draw, (cx, cy, cx + card_w, cy + card_h), "Admin Chatbot", "Form autentikasi admin", fill=COLORS["paper"], radius=16)
    draw.text((cx + 38, cy + 88), "Email admin", font=SMALL, fill=COLORS["text"])
    rect(draw, (cx + 38, cy + 112, cx + card_w - 38, cy + 164), "admin@email.com", fill=COLORS["soft"], radius=8)
    draw.text((cx + 38, cy + 188), "Password", font=SMALL, fill=COLORS["text"])
    rect(draw, (cx + 38, cy + 212, cx + card_w - 38, cy + 264), "********", fill=COLORS["soft"], radius=8)
    pill(draw, (cx + 38, cy + 292, cx + card_w - 38, cy + 342), "Masuk", fill=COLORS["soft2"])


def draw_dashboard(draw, xy):
    x1, y1, x2, y2 = xy
    page_frame(draw, xy, "Dashboard Penggunaan")
    content_y = y1 + 48
    sidebar(draw, x1, content_y, y2 - content_y, "Dashboard")
    mx = x1 + 190
    draw.text((mx, content_y + 28), "Dashboard Penggunaan", font=PANEL_TITLE, fill=COLORS["text"])
    draw.text((mx, content_y + 60), "Ringkasan penggunaan chatbot.", font=SMALL, fill=COLORS["muted"])
    rect(draw, (mx, content_y + 98, x2 - 26, content_y + 154), "Periode Laporan", fill=COLORS["soft"])
    for i, label in enumerate(["Hari ini", "Kemarin", "Minggu ini", "Bulan ini", "Custom"]):
        pill(draw, (mx + 145 + i * 100, content_y + 109, mx + 226 + i * 100, content_y + 143), label, fill=COLORS["paper"])
    for i, label in enumerate(["Pengguna", "Pertanyaan", "Jawaban Bermasalah"]):
        bx = mx + i * 250
        rect(draw, (bx, content_y + 180, bx + 220, content_y + 280), label, "Angka ringkasan", fill=COLORS["paper"])
        draw.rectangle((bx + 16, content_y + 228, bx + 70, content_y + 258), fill=COLORS["dark"])
    rect(draw, (mx, content_y + 310, x2 - 26, content_y + 535), "Grafik Jumlah Pertanyaan", "Berdasarkan filter periode laporan", fill=COLORS["paper"])
    base_y = content_y + 500
    for i, h in enumerate([35, 60, 20, 85, 50, 110, 40, 75]):
        draw.rectangle((mx + 80 + i * 80, base_y - h, mx + 112 + i * 80, base_y), fill=COLORS["dark"])
    rect(draw, (mx, content_y + 565, x2 - 26, y2 - 28), "Pertanyaan Belum Terjawab", "Daftar jawaban bermasalah atau gagal dijawab", fill=COLORS["paper"])


def draw_data_chatbot(draw, xy):
    x1, y1, x2, y2 = xy
    page_frame(draw, xy, "Data Chatbot")
    content_y = y1 + 48
    sidebar(draw, x1, content_y, y2 - content_y, "Data Chatbot")
    mx = x1 + 190
    draw.text((mx, content_y + 28), "Data Chatbot", font=PANEL_TITLE, fill=COLORS["text"])
    draw.text((mx, content_y + 60), "Pengelolaan data RAG chatbot.", font=SMALL, fill=COLORS["muted"])
    rect(draw, (mx, content_y + 98, x2 - 26, content_y + 185), "Upload Excel ke n8n", "Input file Excel untuk memperbarui basis pengetahuan", fill=COLORS["paper"])
    rect(draw, (mx, content_y + 215, x2 - 26, content_y + 405), "Daftar File Data", "Tabel metadata file, status upload, jumlah data, dan aksi", fill=COLORS["paper"])
    headers_y = content_y + 280
    for i, label in enumerate(["File Data", "Status", "Jumlah", "Dibuat", "Aksi"]):
        draw.text((mx + 18 + i * 135, headers_y), label, font=SMALL, fill=COLORS["muted"])
    draw.line((mx + 14, headers_y + 26, x2 - 42, headers_y + 26), fill=COLORS["line"], width=2)
    draw.text((mx + 18, headers_y + 45), "Data Kampus UBL.xlsx", font=SMALL, fill=COLORS["text"])
    pill(draw, (mx + 155, headers_y + 38, mx + 225, headers_y + 70), "Success", fill=COLORS["soft"])
    pill(draw, (x2 - 160, headers_y + 38, x2 - 96, headers_y + 70), "Detail", fill=COLORS["soft"])
    pill(draw, (x2 - 88, headers_y + 38, x2 - 36, headers_y + 70), "Hapus", fill=COLORS["soft2"])
    rect(draw, (mx, content_y + 435, x2 - 26, y2 - 28), "Isi Data", "Detail potongan data setelah file dipilih", fill=COLORS["paper"])
    for i in range(3):
        y = content_y + 510 + i * 45
        draw.rectangle((mx + 18, y, x2 - 150, y + 18), fill=COLORS["soft2"])
        pill(draw, (x2 - 120, y - 8, x2 - 55, y + 28), "Detail", fill=COLORS["soft"])


def draw_chat_history(draw, xy):
    x1, y1, x2, y2 = xy
    page_frame(draw, xy, "Riwayat Chat")
    content_y = y1 + 48
    sidebar(draw, x1, content_y, y2 - content_y, "Chat")
    mx = x1 + 190
    draw.text((mx, content_y + 28), "Riwayat Chat", font=PANEL_TITLE, fill=COLORS["text"])
    draw.text((mx, content_y + 60), "Pencarian, filter, dan ekspor percakapan.", font=SMALL, fill=COLORS["muted"])
    rect(draw, (mx, content_y + 98, x2 - 26, content_y + 205), "Filter Riwayat Chat", "Filter tanggal, pencarian session, pertanyaan, atau jawaban", fill=COLORS["paper"])
    for i, label in enumerate(["Hari ini", "Minggu ini", "Bulan ini", "Ekspor"]):
        pill(draw, (mx + 220 + i * 105, content_y + 125, mx + 305 + i * 105, content_y + 158), label, fill=COLORS["soft"])
    rect(draw, (mx, content_y + 235, x2 - 26, content_y + 395), "Session Pengguna", "Daftar session dengan jumlah pertanyaan dan waktu terakhir", fill=COLORS["paper"])
    for i in range(3):
        y = content_y + 295 + i * 36
        fill = COLORS["active"] if i == 1 else COLORS["soft"]
        rect(draw, (mx + 16, y, x2 - 44, y + 28), fill=fill, radius=6)
    rect(draw, (mx, content_y + 425, x2 - 26, y2 - 28), "Detail Percakapan", "Question from user dan answer from bot ditampilkan atas-bawah", fill=COLORS["paper"])
    for i, label in enumerate(["Question from user", "Answer from bot"]):
        y = content_y + 492 + i * 72
        rect(draw, (mx + 22, y, x2 - 55, y + 54), label, fill=COLORS["soft"] if i == 0 else COLORS["soft2"], radius=8)


def main():
    img = Image.new("RGB", (2500, 1800), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw.text((70, 44), "Wireframe Antarmuka Admin Chatbot", font=TITLE, fill=COLORS["text"])
    draw.text((72, 98), "Rancangan low-fidelity untuk halaman login, dashboard, pengelolaan data chatbot, dan riwayat chat.", font=SUBTITLE, fill=COLORS["muted"])

    panels = [
        ((70, 170, 1205, 860), "A. Login Admin", draw_login),
        ((1295, 170, 2430, 860), "B. Dashboard Penggunaan", draw_dashboard),
        ((70, 960, 1205, 1650), "C. Data Chatbot", draw_data_chatbot),
        ((1295, 960, 2430, 1650), "D. Riwayat Chat", draw_chat_history),
    ]
    for xy, title, fn in panels:
        draw.text((xy[0] + 8, xy[1] - 36), title, font=PANEL_TITLE, fill=COLORS["text"])
        fn(draw, xy)

    draw.text((70, 1720), "Gambar: wireframe antarmuka admin chatbot untuk mengelola dashboard penggunaan, data RAG, dan riwayat percakapan.", font=TEXT, fill=COLORS["muted"])
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
