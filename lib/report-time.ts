const REPORT_TIME_ZONE = "Asia/Jakarta";

// Existing timestamp-without-time-zone values were written in UTC+8.
// Treat them as one hour ahead of WIB until the database is normalized.
const STORAGE_AHEAD_OF_WIB_HOURS = 1;

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

export function toStoredSqlTimestamp(wibWallClock: Date) {
  const storedClock = new Date(wibWallClock);
  storedClock.setUTCHours(storedClock.getUTCHours() + STORAGE_AHEAD_OF_WIB_HOURS);

  return `${storedClock.getUTCFullYear()}-${pad(storedClock.getUTCMonth() + 1)}-${pad(
    storedClock.getUTCDate()
  )} ${pad(storedClock.getUTCHours())}:${pad(storedClock.getUTCMinutes())}:${pad(
    storedClock.getUTCSeconds()
  )}`;
}

export function formatWibDateOnly(wibWallClock: Date) {
  return `${wibWallClock.getUTCFullYear()}-${pad(wibWallClock.getUTCMonth() + 1)}-${pad(
    wibWallClock.getUTCDate()
  )}`;
}

export function parseStoredTimestampAsWib(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);

  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - STORAGE_AHEAD_OF_WIB_HOURS,
      Number(minute),
      Number(second)
    )
  );
}
