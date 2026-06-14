export function formatIndonesianDateTime(value?: string) {
  if (!value) return "-";

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/
  );

  if (!match) return value;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const wibDate = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 1,
      Number(minute),
      Number(second)
    )
  );
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

      const record = item as Record<string, unknown>;
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request gagal.");
  }
  return data;
}
