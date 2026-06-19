const REPORT_TIME_ZONE = "Asia/Jakarta";
const WIB_OFFSET_HOURS = 7;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getCurrentWibWallClock() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    )
  );
}

export function startOfWibDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export function addWibDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function parseWibDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toWibInstant(wibWallClock: Date) {
  const instant = new Date(wibWallClock);
  instant.setUTCHours(instant.getUTCHours() - WIB_OFFSET_HOURS);
  return instant;
}

export function toStoredSqlTimestamp(wibWallClock: Date, columnType?: string) {
  const normalizedColumnType = (columnType || "").toLowerCase();

  if (normalizedColumnType === "timestamp with time zone") {
    return toWibInstant(wibWallClock).toISOString();
  }

  return `${wibWallClock.getUTCFullYear()}-${pad(wibWallClock.getUTCMonth() + 1)}-${pad(
    wibWallClock.getUTCDate()
  )} ${pad(wibWallClock.getUTCHours())}:${pad(wibWallClock.getUTCMinutes())}:${pad(
    wibWallClock.getUTCSeconds()
  )}`;
}

export function getTimestampSqlCast(columnType?: string) {
  return (columnType || "").toLowerCase() === "timestamp with time zone" ? "timestamptz" : "timestamp";
}

export function formatWibDateOnly(wibWallClock: Date) {
  return `${wibWallClock.getUTCFullYear()}-${pad(wibWallClock.getUTCMonth() + 1)}-${pad(
    wibWallClock.getUTCDate()
  )}`;
}

export function parseStoredTimestampAsWib(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const trimmed = text.trim();
  const hasTimeZone = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed);

  if (hasTimeZone) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const wibDate = new Date(parsed);
      wibDate.setUTCHours(wibDate.getUTCHours() + WIB_OFFSET_HOURS);
      return wibDate;
    }
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);

  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  return new Date(
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
