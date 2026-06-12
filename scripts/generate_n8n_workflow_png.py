from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "n8n-workflow-final.png"


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for item in candidates:
        if item.exists():
            return ImageFont.truetype(str(item), size)
    return ImageFont.load_default()


TITLE = font(54, True)
SUBTITLE = font(28, False)
PANEL_TITLE = font(34, True)
BOX_TITLE = font(26, True)
BOX_TEXT = font(22, False)
SMALL = font(20, False)
SMALL_BOLD = font(20, True)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int):
    lines = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        line = ""
        for word in words:
            candidate = word if not line else f"{line} {word}"
            if text_size(draw, candidate, fnt)[0] <= max_width:
                line = candidate
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
    return lines


def rounded_box(draw, xy, title, body="", fill="#ffffff", outline="#cbd5e1", accent="#0f766e"):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=24, fill=fill, outline=outline, width=2)
    draw.rounded_rectangle((x1, y1, x1 + 14, y2), radius=8, fill=accent)
    content_x = x1 + 34
    title_lines = wrap_text(draw, title, BOX_TITLE, x2 - content_x - 26)
    y = y1 + 22
    for line in title_lines:
        draw.text((content_x, y), line, fill="#0f172a", font=BOX_TITLE)
        y += 31
    if body:
        y += 8
        for line in wrap_text(draw, body, BOX_TEXT, x2 - content_x - 26):
            draw.text((content_x, y), line, fill="#475569", font=BOX_TEXT)
            y += 28


def diamond(draw, cx, cy, w, h, title, fill="#fff7ed", outline="#fdba74"):
    points = [(cx, cy - h // 2), (cx + w // 2, cy), (cx, cy + h // 2), (cx - w // 2, cy)]
    draw.polygon(points, fill=fill, outline=outline)
    draw.line(points + [points[0]], fill=outline, width=3)
    lines = wrap_text(draw, title, BOX_TITLE, w - 70)
    total_h = len(lines) * 31
    y = cy - total_h // 2
    for line in lines:
        tw, th = text_size(draw, line, BOX_TITLE)
        draw.text((cx - tw // 2, y), line, fill="#0f172a", font=BOX_TITLE)
        y += 31


def arrow(draw, start, end, color="#64748b", width=4, label=None):
    x1, y1 = start
    x2, y2 = end
    draw.line((x1, y1, x2, y2), fill=color, width=width)
    import math

    angle = math.atan2(y2 - y1, x2 - x1)
    size = 15
    p1 = (x2 - size * math.cos(angle - 0.45), y2 - size * math.sin(angle - 0.45))
    p2 = (x2 - size * math.cos(angle + 0.45), y2 - size * math.sin(angle + 0.45))
    draw.polygon([(x2, y2), p1, p2], fill=color)
    if label:
        mx, my = (x1 + x2) // 2, (y1 + y2) // 2
        tw, th = text_size(draw, label, SMALL_BOLD)
        draw.rounded_rectangle((mx - tw // 2 - 10, my - th // 2 - 6, mx + tw // 2 + 10, my + th // 2 + 6), radius=10, fill="#ffffff", outline="#cbd5e1")
        draw.text((mx - tw // 2, my - th // 2 - 1), label, fill="#0f172a", font=SMALL_BOLD)


def panel(draw, xy, title, subtitle, accent):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=34, fill="#f8fafc", outline="#cbd5e1", width=2)
    draw.rounded_rectangle((x1, y1, x2, y1 + 88), radius=34, fill="#ffffff")
    draw.rectangle((x1, y1 + 50, x2, y1 + 88), fill="#ffffff")
    draw.rounded_rectangle((x1, y1, x1 + 18, y1 + 88), radius=8, fill=accent)
    draw.text((x1 + 44, y1 + 20), title, fill="#0f172a", font=PANEL_TITLE)
    draw.text((x1 + 44, y1 + 59), subtitle, fill="#64748b", font=SMALL)


def main():
    img = Image.new("RGB", (3000, 2150), "#eef4f8")
    draw = ImageDraw.Draw(img)

    # subtle grid
    for x in range(0, img.width, 80):
        draw.line((x, 0, x, img.height), fill="#dbe5ee", width=1)
    for y in range(0, img.height, 80):
        draw.line((0, y, img.width, y), fill="#dbe5ee", width=1)

    draw.text((100, 70), "Rancangan Workflow n8n Chatbot PMB UBL", fill="#06101f", font=TITLE)
    draw.text((102, 137), "Pemisahan proses inference chatbot dan ingestion data RAG berbasis PostgreSQL, pgvector, dan AI Agent.", fill="#475569", font=SUBTITLE)

    left = (90, 230, 1450, 2030)
    right = (1540, 230, 2910, 2030)
    panel(draw, left, "Workflow Chatbot", "Menjawab pertanyaan pengguna", "#0f766e")
    panel(draw, right, "Workflow Upload Data RAG", "Memperbarui basis pengetahuan", "#2563eb")

    lx, ly = 155, 385
    bw, bh = 500, 118
    step_gap = 152

    rounded_box(draw, (lx, ly, lx + bw, ly + bh), "Webhook dari Next.js", "Menerima pertanyaan dan session_id pengguna.", accent="#0f766e")
    rounded_box(draw, (lx, ly + step_gap, lx + bw, ly + step_gap + bh), "Cek Session PostgreSQL", "Mengambil data session pengguna.", accent="#0f766e")
    diamond(draw, lx + bw // 2, ly + step_gap * 2 + 70, 410, 150, "Session ada?")
    rounded_box(draw, (lx + 610, ly + step_gap * 2 + 10, lx + 1120, ly + step_gap * 2 + 128), "Buat Session Baru", "Insert session jika belum ditemukan.", accent="#f59e0b")
    rounded_box(draw, (lx, ly + step_gap * 3 + 38, lx + bw, ly + step_gap * 3 + 168), "AI Agent", "Memproses pertanyaan, memory, dan konteks RAG.", accent="#7c3aed")

    tool_x = lx + 645
    rounded_box(draw, (tool_x, ly + step_gap * 3 + 18, tool_x + 560, ly + step_gap * 3 + 128), "Chat Memory PostgreSQL", "Menyediakan riwayat percakapan.", accent="#64748b")
    rounded_box(draw, (tool_x, ly + step_gap * 4 + 10, tool_x + 560, ly + step_gap * 4 + 128), "PGVector Store", "Similarity search pada dokumen RAG.", accent="#0ea5e9")
    rounded_box(draw, (tool_x, ly + step_gap * 5 + 4, tool_x + 560, ly + step_gap * 5 + 122), "OpenAI Chat Model", "Menyusun jawaban akhir dari prompt, memory, dan konteks.", accent="#22c55e")

    rounded_box(draw, (lx, ly + step_gap * 5 + 52, lx + bw, ly + step_gap * 5 + 180), "Jawaban Chatbot", "Jawaban dibuat berdasarkan konteks yang tersedia.", accent="#7c3aed")
    rounded_box(draw, (lx, ly + step_gap * 6 + 88, lx + bw, ly + step_gap * 6 + 220), "Simpan Riwayat Chat", "Menyimpan pesan dan update last_used session.", accent="#0f766e")
    rounded_box(draw, (lx, ly + step_gap * 8 - 10, lx + bw, ly + step_gap * 8 + 120), "Respond to Webhook", "Mengirim jawaban kembali ke frontend.", accent="#0f766e")

    arrow(draw, (lx + bw // 2, ly + bh), (lx + bw // 2, ly + step_gap))
    arrow(draw, (lx + bw // 2, ly + step_gap + bh), (lx + bw // 2, ly + step_gap * 2 - 5))
    arrow(draw, (lx + bw // 2 + 205, ly + step_gap * 2 + 70), (lx + 610, ly + step_gap * 2 + 70), label="Tidak")
    arrow(draw, (lx + 865, ly + step_gap * 2 + 128), (lx + bw, ly + step_gap * 3 + 100))
    arrow(draw, (lx + bw // 2, ly + step_gap * 2 + 145), (lx + bw // 2, ly + step_gap * 3 + 38), label="Ya")
    arrow(draw, (lx + bw, ly + step_gap * 3 + 83), (tool_x, ly + step_gap * 3 + 73))
    arrow(draw, (lx + bw, ly + step_gap * 3 + 100), (tool_x, ly + step_gap * 4 + 68))
    arrow(draw, (lx + bw, ly + step_gap * 3 + 117), (tool_x, ly + step_gap * 5 + 63))
    arrow(draw, (tool_x, ly + step_gap * 5 + 100), (lx + bw, ly + step_gap * 5 + 116))
    arrow(draw, (lx + bw // 2, ly + step_gap * 3 + 168), (lx + bw // 2, ly + step_gap * 5 + 52))
    arrow(draw, (lx + bw // 2, ly + step_gap * 5 + 180), (lx + bw // 2, ly + step_gap * 6 + 88))
    arrow(draw, (lx + bw // 2, ly + step_gap * 6 + 220), (lx + bw // 2, ly + step_gap * 8 - 10))

    rx, ry = 1608, 385
    rbw, rbh = 540, 116
    steps = [
        ("Upload Excel Admin Panel", "Admin memilih file Excel dari panel web.", "#2563eb"),
        ("Webhook Upload n8n", "Menerima file dari aplikasi Next.js.", "#2563eb"),
        ("Baca Semua Sheet Excel", "Mengambil data dari seluruh sheet file.", "#0ea5e9"),
        ("Ubah Baris Jadi Dokumen", "Setiap baris menjadi teks dengan metadata file, sheet, dan row.", "#0ea5e9"),
        ("Text Splitter", "Memecah dokumen panjang menjadi bagian lebih kecil jika diperlukan.", "#64748b"),
        ("OpenAI Embeddings", "Mengubah teks menjadi representasi vektor.", "#22c55e"),
        ("Simpan ke Documents pgvector", "Menyimpan text, metadata, dan embedding.", "#0f766e"),
        ("Simpan/Update metadata_table", "Mencatat nama file, status upload, dan waktu proses.", "#f59e0b"),
        ("Status ke Admin Panel", "Mengirim hasil berhasil atau gagal ke website admin.", "#2563eb"),
    ]
    for idx, (title, body, accent) in enumerate(steps):
        y = ry + idx * 160
        rounded_box(draw, (rx, y, rx + rbw, y + rbh), title, body, accent=accent)
        if idx < len(steps) - 1:
            arrow(draw, (rx + rbw // 2, y + rbh), (rx + rbw // 2, y + 160))

    note_x, note_y = 2210, 450
    rounded_box(draw, (note_x, note_y, note_x + 560, note_y + 220), "Catatan Metodologis", "Workflow chatbot adalah proses inference. Workflow upload data RAG adalah proses ingestion knowledge base.", fill="#ecfeff", outline="#67e8f9", accent="#0891b2")
    rounded_box(draw, (note_x, note_y + 300, note_x + 560, note_y + 540), "Peran Embedding", "Embedding digunakan untuk membandingkan query pengguna dengan dokumen pada pgvector melalui similarity search.", fill="#f0fdf4", outline="#86efac", accent="#16a34a")
    rounded_box(draw, (note_x, note_y + 620, note_x + 560, note_y + 855), "Kontrol Admin", "metadata_table membantu mengecek file yang pernah diunggah dan menentukan apakah data lama ditimpa.", fill="#fff7ed", outline="#fdba74", accent="#f59e0b")

    draw.text((100, 2070), "Gambar: rancangan workflow n8n untuk chatbot PMB UBL dan pengelolaan data RAG.", fill="#475569", font=SMALL)
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
