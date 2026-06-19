import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, rowsToJsonExpression, withClient } from "@/lib/db";
import { asText } from "@/lib/normalize";
import {
  addWibDays,
  formatWibDateOnly,
  getCurrentWibWallClock,
  getTimestampSqlCast,
  parseStoredTimestampAsWib,
  parseWibDateOnly,
  startOfWibDay,
  toStoredSqlTimestamp
} from "@/lib/report-time";

type RangeName = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
type Granularity = "three_hour" | "day" | "week";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function addDays(date: Date, days: number) {
  return addWibDays(date, days);
}

function getFilterFromUrl(url: string) {
  const searchParams = new URL(url).searchParams;
  const requestedRange = searchParams.get("range");
  const range: RangeName =
    requestedRange === "today" ||
    requestedRange === "yesterday" ||
    requestedRange === "this_week" ||
    requestedRange === "last_week" ||
    requestedRange === "this_month" ||
    requestedRange === "last_month" ||
    requestedRange === "custom"
      ? requestedRange
      : "today";
  const now = getCurrentWibWallClock();
  let start = startOfWibDay(now);
  let end = addDays(start, 1);

  if (range === "yesterday") {
    end = start;
    start = addDays(start, -1);
  }

  if (range === "this_week" || range === "last_week") {
    const day = start.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start = addDays(start, diffToMonday);
    end = addDays(start, 7);
    if (range === "last_week") {
      end = start;
      start = addDays(start, -7);
    }
  }

  if (range === "this_month" || range === "last_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (range === "last_month") {
      end = start;
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    }
  }

  if (range === "custom") {
    const customStart = parseWibDateOnly(searchParams.get("startDate"));
    const customEnd = parseWibDateOnly(searchParams.get("endDate"));
    if (customStart) start = startOfWibDay(customStart);
    if (customEnd) end = addDays(startOfWibDay(customEnd), 1);
    if (end <= start) end = addDays(start, 1);
  }

  const durationMs = end.getTime() - start.getTime();
  const durationDays = Math.ceil(durationMs / (24 * 60 * 60 * 1000));
  const granularity: Granularity =
    durationMs <= 24 * 60 * 60 * 1000
      ? "three_hour"
      : range === "this_month" || range === "last_month" || durationDays > 31
        ? "week"
        : "day";

  return {
    range,
    start,
    end,
    granularity,
    startSql: toStoredSqlTimestamp(start),
    endSql: toStoredSqlTimestamp(end)
  };
}

function getColumnType(columns: Array<{ column_name: string; data_type: string }>, columnName?: string) {
  return columns.find((column) => column.column_name === columnName)?.data_type;
}

function canNormalizeWebhookUtcStart(timeStartColumnType?: string, timeEndColumnType?: string) {
  return (
    (timeStartColumnType || "").toLowerCase() === "timestamp without time zone" &&
    (timeEndColumnType || "").toLowerCase() === "timestamp without time zone"
  );
}

function getChatStartExpression(
  timeStartColumn: string | undefined,
  timeEndColumn: string | undefined,
  timeStartColumnType?: string,
  timeEndColumnType?: string
) {
  if (!timeStartColumn) return "null";

  const startExpression = `h.${quoteIdent(timeStartColumn)}`;
  if (!timeEndColumn || !canNormalizeWebhookUtcStart(timeStartColumnType, timeEndColumnType)) {
    return startExpression;
  }

  const endExpression = `h.${quoteIdent(timeEndColumn)}`;
  return `case
    when ${endExpression} is not null
      and extract(epoch from (${endExpression} - ${startExpression})) between 21600 and 28800
    then ${startExpression} + interval '7 hours'
    else ${startExpression}
  end`;
}

function parseStoredTimestamp(value: unknown) {
  return parseStoredTimestampAsWib(asText(value));
}

function asBooleanFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = asText(value).trim().toLowerCase();
  return normalized === "true" || normalized === "t" || normalized === "1" || normalized === "yes";
}

function formatSeriesLabel(date: Date, granularity: Granularity) {
  const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");

  if (granularity === "three_hour") return `${hour}.00`;
  return `${days[date.getUTCDay()]} ${day}`;
}

function formatHourRangeLabel(date: Date) {
  const startHour = date.getUTCHours();
  const endHour = startHour + 2;
  return `${pad(startHour)}-${pad(endHour)}`;
}

function formatWeekLabel(index: number, start: Date, end: Date) {
  const startDay = pad(start.getUTCDate());
  const endDay = pad(addDays(end, -1).getUTCDate());
  return `Minggu ${index} (${startDay}-${endDay})`;
}

function getBucketKey(date: Date, granularity: Granularity, origin?: Date) {
  if (granularity === "three_hour") {
    const bucketHour = Math.floor(date.getUTCHours() / 3) * 3;
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${bucketHour}`;
  }

  if (granularity === "week") {
    const originDate = origin || new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const dayIndex = Math.floor((date.getTime() - originDate.getTime()) / (24 * 60 * 60 * 1000));
    const weekIndex = Math.floor(dayIndex / 7) + 1;
    return `week-${weekIndex}`;
  }

  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function buildQuestionSeries(
  questions: Array<{ raw: Record<string, unknown> }>,
  timeColumn: string | undefined,
  start: Date,
  end: Date,
  granularity: Granularity
) {
  if (!timeColumn) return [];

  const buckets: Array<{ key: string; label: string; count: number }> = [];
  const cursor = new Date(start);
  const origin = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cursor < end && buckets.length < 370) {
    const bucketStart = new Date(cursor);
    let bucketEnd = new Date(cursor);

    if (granularity === "three_hour") bucketEnd.setUTCHours(bucketEnd.getUTCHours() + 3);
    else if (granularity === "week") bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 7);
    else bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 1);

    if (bucketEnd > end) bucketEnd = new Date(end);

    buckets.push({
      key: getBucketKey(
        new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours())),
        granularity,
        origin
      ),
      label:
        granularity === "three_hour"
          ? formatHourRangeLabel(
              new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours()))
            )
          : granularity === "week"
            ? formatWeekLabel(buckets.length + 1, bucketStart, bucketEnd)
            : formatSeriesLabel(
                new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate())),
                granularity
              ),
      count: 0
    });

    if (granularity === "three_hour") cursor.setUTCHours(cursor.getUTCHours() + 3);
    else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const question of questions) {
    const date = parseStoredTimestamp(question.raw[timeColumn]);
    if (!date) continue;

    const key = getBucketKey(date, granularity, origin);
    const bucket = bucketMap.get(key);
    if (bucket) bucket.count += 1;
  }

  return buckets.map(({ label, count }) => ({ label, count }));
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filter = getFilterFromUrl(request.url);

  try {
    const data = await withClient(async (client) => {
      const historyInfo = await getColumns(client, "chat_history");
      const sessionColumn = pickColumn(historyInfo.columns, ["session_id", "sessionId"]);
      const questionColumn = pickColumn(historyInfo.columns, ["question"]);
      const answerColumn = pickColumn(historyInfo.columns, ["answer"]);
      const timeColumn = pickColumn(historyInfo.columns, ["time_start", "started_at", "created_at"]);
      const timeEndColumn = pickColumn(historyInfo.columns, ["time_end", "ended_at", "completed_at"]);
      const idColumn = pickColumn(historyInfo.columns, ["id"]);
      const fallbackColumn = pickColumn(historyInfo.columns, ["isfallback", "isFallback", "is_fallback"]);
      const timeColumnType = getColumnType(historyInfo.columns, timeColumn);
      const timeEndColumnType = getColumnType(historyInfo.columns, timeEndColumn);
      const timeSqlCast = getTimestampSqlCast(timeColumnType);
      const startSql = toStoredSqlTimestamp(filter.start, timeColumnType);
      const endSql = toStoredSqlTimestamp(filter.end, timeColumnType);
      const chatStartExpression = getChatStartExpression(timeColumn, timeEndColumn, timeColumnType, timeEndColumnType);

      if (!sessionColumn || !questionColumn || !answerColumn) {
        throw new Error("Tabel chat_history harus memiliki kolom session_id, question, dan answer.");
      }

      const historyWhere = timeColumn
        ? `where ${chatStartExpression} >= $1::${timeSqlCast} and ${chatStartExpression} < $2::${timeSqlCast}`
        : "";
      const timeParams = [startSql, endSql];

      const [sessionCount, rawHistory] = await Promise.all([
        client.query<{ count: number }>(
          `
            select count(distinct h.${quoteIdent(sessionColumn)})::int as count
            from ${historyInfo.table.sql} h
            ${historyWhere}
          `,
          timeColumn ? timeParams : []
        ),
        client.query(
          `
            select
              ${rowsToJsonExpression("h", historyInfo.columns)} as row,
              ${timeColumn ? `(${chatStartExpression})::text` : "null"} as "normalizedTime"
            from ${historyInfo.table.sql} h
            ${historyWhere}
            ${timeColumn ? `order by ${chatStartExpression} asc` : idColumn ? `order by h.${quoteIdent(idColumn)} asc` : ""}
            limit 10000
          `,
          timeColumn ? timeParams : []
        )
      ]);

      const questions = rawHistory.rows
        .map((item) => {
          const raw = item.row as Record<string, unknown>;
          if (timeColumn && item.normalizedTime) raw[timeColumn] = item.normalizedTime;
          return { raw };
        })
        .filter((item) => asText(item.raw[questionColumn]));
      const questionSeries = buildQuestionSeries(questions, timeColumn, filter.start, filter.end, filter.granularity);
      const unansweredPattern = /\bmaaf\b/i;
      const unansweredPairs = questions
        .filter((item) =>
          fallbackColumn
            ? asBooleanFlag(item.raw[fallbackColumn])
            : unansweredPattern.test(asText(item.raw[answerColumn]))
        )
        .map((item) => ({
          sessionId: asText(item.raw[sessionColumn]),
          question: asText(item.raw[questionColumn]),
          answer: asText(item.raw[answerColumn]),
          isFallback: fallbackColumn ? asBooleanFlag(item.raw[fallbackColumn]) : true,
          createdAt: timeColumn ? asText(item.raw[timeColumn]) : undefined
        }));

      return {
        range: filter.range,
        filter: {
          startDate: formatWibDateOnly(filter.start),
          endDate: formatWibDateOnly(addDays(filter.end, -1)),
          granularity: filter.granularity
        },
        stats: {
          users: sessionCount.rows[0]?.count || 0,
          chats: questions.length,
          unanswered: unansweredPairs.length
        },
        questionSeries,
        unansweredSamples: unansweredPairs
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca dashboard.") }, { status: 500 });
  }
}
