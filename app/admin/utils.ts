export function formatIndonesianDateTime(value?: string) {
  if (!value) return "-";

  const trimmed = value.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/
  );

  if (!match) return value;

  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember"
  ];
  const twoDigit = (item: number) => String(item).padStart(2, "0");
  let wibDate: Date;

  if (hasTimeZone) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return value;

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    wibDate = new Date(
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
      )
    );
  } else {
    const [, year, month, day, hour, minute, second = "0"] = match;
    wibDate = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      )
    );
  }

  return `${days[wibDate.getUTCDay()]}, ${twoDigit(wibDate.getUTCDate())} ${
    months[wibDate.getUTCMonth()]
  } ${wibDate.getUTCFullYear()} pukul ${twoDigit(wibDate.getUTCHours())}.${twoDigit(
    wibDate.getUTCMinutes()
  )}`;
}

export function getContextItems(value: unknown) {
  let parsed = value;

  if (typeof parsed === "string") {
    const text = parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text.trim() ? [{ content: text.trim(), metadata: null }] : [];
    }
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    parsed = record.retrieved_contexts ?? record.contexts ?? record.context ?? [record];
  }

  const items = Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed];

  return items
    .map((item) => {
      if (typeof item === "string") return { content: item, metadata: null };
      if (!item || typeof item !== "object") {
        return { content: String(item ?? ""), metadata: null };
      }

      const record = item as Record<string, any>; // Menggunakan any agar fleksibel saat membaca raw text/content dari RAG
      const content = record.pageContent ?? record.page_content ?? record.content ?? record.text;
      return {
        content: typeof content === "string" ? content : JSON.stringify(record, null, 2),
        metadata: record.metadata ?? null
      };
    })
    .filter((item) => item.content.trim());
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  // Session habis / belum login → paksa redirect ke /login, jangan cuma
  // tampilkan teks "Unauthorized" di panel.
  if (response.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Sesi login sudah berakhir. Mengalihkan ke halaman login...");
  }

  // Menangani penanganan error stream jika response kosong/bukan JSON valid
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request gagal.");
  }
  return data;
}