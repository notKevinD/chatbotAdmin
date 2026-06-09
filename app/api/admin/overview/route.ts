import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, rowsToJsonExpression, withClient } from "@/lib/db";
import { asText, isInternalAgentMessage, looksLikeAnswer, looksLikeQuestion, normalizeMessage } from "@/lib/normalize";

type RangeName = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
type Granularity = "three_hour" | "day" | "week";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toSqlTimestamp(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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
  const now = new Date();
  let start = startOfDay(now);
  let end = addDays(start, 1);

  if (range === "yesterday") {
    end = start;
    start = addDays(start, -1);
  }

  if (range === "this_week" || range === "last_week") {
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start = addDays(start, diffToMonday);
    end = addDays(start, 7);
    if (range === "last_week") {
      end = start;
      start = addDays(start, -7);
    }
  }

  if (range === "this_month" || range === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    if (range === "last_month") {
      end = start;
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    }
  }

  if (range === "custom") {
    const customStart = parseDateOnly(searchParams.get("startDate"));
    const customEnd = parseDateOnly(searchParams.get("endDate"));
    if (customStart) start = startOfDay(customStart);
    if (customEnd) end = addDays(startOfDay(customEnd), 1);
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
    startSql: toSqlTimestamp(start),
    endSql: toSqlTimestamp(end)
  };
}

function parseStoredTimestamp(value: unknown) {
  const text = asText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);

  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 1,
      Number(minute),
      Number(second)
    )
  );
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
  const startDay = pad(start.getDate());
  const endDay = pad(addDays(end, -1).getDate());
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
  const origin = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
  while (cursor < end && buckets.length < 370) {
    const bucketStart = new Date(cursor);
    let bucketEnd = new Date(cursor);

    if (granularity === "three_hour") bucketEnd.setHours(bucketEnd.getHours() + 3);
    else if (granularity === "week") bucketEnd.setDate(bucketEnd.getDate() + 7);
    else bucketEnd.setDate(bucketEnd.getDate() + 1);

    if (bucketEnd > end) bucketEnd = new Date(end);

    buckets.push({
      key: getBucketKey(
        new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours())),
        granularity,
        origin
      ),
      label:
        granularity === "three_hour"
          ? formatHourRangeLabel(new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours())))
          : granularity === "week"
            ? formatWeekLabel(buckets.length + 1, bucketStart, bucketEnd)
            : formatSeriesLabel(new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())), granularity),
      count: 0
    });

    if (granularity === "three_hour") cursor.setHours(cursor.getHours() + 3);
    else if (granularity === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
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
        const messageInfo = await getColumns(client, "message");
        const sessionInfo = await getColumns(client, "chat_sessions");

      const messageTime = pickColumn(messageInfo.columns, ["created_at", "createdAt", "timestamp", "date", "time"]);
      const sessionCreated = pickColumn(sessionInfo.columns, ["created_at", "createdAt", "timestamp", "date"]);
      const messageSession = pickColumn(messageInfo.columns, ["session_id", "sessionId"]);
      const messageId = pickColumn(messageInfo.columns, ["id"]);

      const messageWhere = messageTime
        ? `where m.${quoteIdent(messageTime)} >= $1::timestamp and m.${quoteIdent(messageTime)} < $2::timestamp`
        : "";
      const sessionWhere = sessionCreated
        ? `where s.${quoteIdent(sessionCreated)} >= $1::timestamp and s.${quoteIdent(sessionCreated)} < $2::timestamp`
        : "";
      const timeParams = [filter.startSql, filter.endSql];

      const [sessionCount, rawMessages] = await Promise.all([
        client.query(`select count(*)::int as count from ${sessionInfo.table.sql} s ${sessionWhere}`, sessionCreated ? timeParams : []),
        client.query(
          `
            select ${rowsToJsonExpression("m", messageInfo.columns)} as row
            from ${messageInfo.table.sql} m
            ${messageWhere}
            ${messageTime ? `order by m.${quoteIdent(messageTime)} desc` : messageId ? `order by m.${quoteIdent(messageId)} desc` : ""}
            limit 1500
          `,
          messageTime ? timeParams : []
        )
      ]);

      const normalized = rawMessages.rows
        .map((item) => normalizeMessage(item.row))
        .filter((item) => !isInternalAgentMessage(item.role, item.content));
      const questions = normalized.filter((item) => looksLikeQuestion(item.role) && item.content);
      const questionSeries = buildQuestionSeries(questions, messageTime, filter.start, filter.end, filter.granularity);
      const unansweredPattern =
        /tidak tahu|tidak bisa|tidak tercantum|tidak tersedia|tidak ditemukan|tidak memiliki data|data .* tidak ada|belum tersedia|belum menemukan|not found|i don't know|mohon maaf/i;
      const unansweredPairs: Array<{
        sessionId: string;
        question: string;
        answer: string;
        createdAt?: string;
      }> = [];
      const pendingQuestions = new Map<string, string>();

      for (const item of normalized.reverse()) {
        const sessionId = messageSession ? asText(item.raw[messageSession]) : "default";

        if (looksLikeQuestion(item.role)) {
          pendingQuestions.set(sessionId, item.content);
        } else if (looksLikeAnswer(item.role) && pendingQuestions.has(sessionId)) {
          const question = pendingQuestions.get(sessionId) || "";
          if (unansweredPattern.test(item.content)) {
            unansweredPairs.push({
              sessionId,
              question,
              answer: item.content,
              createdAt: messageTime ? asText(item.raw[messageTime]) : undefined
            });
          }
          pendingQuestions.delete(sessionId);
        }
      }

      return {
        range: filter.range,
        filter: {
          startDate: filter.startSql.slice(0, 10),
          endDate: toSqlTimestamp(addDays(filter.end, -1)).slice(0, 10),
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
