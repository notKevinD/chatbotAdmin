import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, rowsToJsonExpression, withClient } from "@/lib/db";
import { isInternalAgentMessage, looksLikeAnswer, looksLikeQuestion, normalizeMessage } from "@/lib/normalize";
import * as XLSX from "xlsx";

type RangeName = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

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

function getFilter(searchParams: URLSearchParams) {
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
      : "this_week";
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

  return {
    range,
    startSql: toSqlTimestamp(start),
    endSql: toSqlTimestamp(end)
  };
}

function buildPairs(
  messages: Array<{
    sessionId: string;
    createdAt?: string;
    role: string;
    content: string;
    category: string;
  }>
) {
  const pairs: Array<{ sessionId: string; question: string; answer: string; category?: string; createdAt?: string }> = [];
  const pending = new Map<string, { question: string; category: string; createdAt?: string }>();

  for (const item of messages) {
    if (looksLikeQuestion(item.role)) {
      pending.set(item.sessionId, {
        question: item.content,
        category: item.category,
        createdAt: item.createdAt
      });
    } else if (looksLikeAnswer(item.role) && pending.has(item.sessionId)) {
      const question = pending.get(item.sessionId);
      if (question) {
        pairs.push({
          sessionId: item.sessionId,
          question: question.question,
          answer: item.content,
          category: question.category || item.category,
          createdAt: question.createdAt || item.createdAt
        });
      }
      pending.delete(item.sessionId);
    }
  }

  for (const [sessionId, item] of pending) {
    pairs.push({
      sessionId,
      question: item.question,
      answer: "",
      category: item.category,
      createdAt: item.createdAt
    });
  }

  return pairs;
}

function toExcelBuffer(rows: Array<Record<string, unknown>>) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 46 },
    { wch: 58 },
    { wch: 64 },
    { wch: 38 },
    { wch: 28 },
    { wch: 22 },
    { wch: 20 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "RAGAS Export");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const session = url.searchParams.get("session");
  const exportType = url.searchParams.get("export");
  const search = (url.searchParams.get("q") || "").trim();
  const filter = getFilter(url.searchParams);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 100);
  const offset = (page - 1) * limit;

  try {
    const data = await withClient(async (client) => {
      const info = await getColumns(client, "message");
      const sessionColumn = pickColumn(info.columns, ["session_id", "sessionId", "sesson_id", "id_session"]);
      const timeColumn = pickColumn(info.columns, ["created_at", "createdAt", "timestamp", "date", "time"]);
      const idColumn = pickColumn(info.columns, ["id"]);

      if (!sessionColumn) {
        throw new Error("Kolom session id tidak ditemukan di tabel message.");
      }

      const timeCondition = timeColumn
        ? `m.${quoteIdent(timeColumn)} >= $1::timestamp and m.${quoteIdent(timeColumn)} < $2::timestamp`
        : "true";
      const timeParams = timeColumn ? [filter.startSql, filter.endSql] : [];

      if (exportType === "ragas") {
        const result = await client.query<{ session_id: string; created_at?: string; raw: Record<string, unknown> }>(
          `
            select
              m.${quoteIdent(sessionColumn)}::text as session_id,
              ${timeColumn ? `m.${quoteIdent(timeColumn)}::text` : "null"} as created_at,
              ${rowsToJsonExpression("m", info.columns)} as raw
            from ${info.table.sql} m
            where ${timeCondition}
            ${timeColumn ? `order by m.${quoteIdent(timeColumn)} asc` : idColumn ? `order by m.${quoteIdent(idColumn)} asc` : ""}
            limit 10000
          `,
          timeParams
        );
        const messages = result.rows
          .map((row) => ({
            sessionId: row.session_id,
            createdAt: row.created_at,
            ...normalizeMessage(row.raw)
          }))
          .filter((item) => !isInternalAgentMessage(item.role, item.content));
        const pairs = buildPairs(messages);
        const filteredPairs = search
          ? pairs.filter(
              (pair) =>
                pair.sessionId.toLowerCase().includes(search.toLowerCase()) ||
                pair.question.toLowerCase().includes(search.toLowerCase()) ||
                pair.answer.toLowerCase().includes(search.toLowerCase())
            )
          : pairs;

        await writeAuditLog({
          request,
          userId: admin.id,
          action: "export_ragas_chat",
          detail: { range: filter.range, search, total: filteredPairs.length }
        });

        return {
          exportRows: filteredPairs.map((pair) => ({
            question: pair.question,
            answer: pair.answer,
            contexts: "",
            ground_truth: "",
            session_id: pair.sessionId,
            created_at: pair.createdAt || "",
            category: pair.category || ""
          }))
        };
      }

      if (!session) {
        const sessionInfo = await getColumns(client, "chat_sessions");
        const sessionIdColumn = pickColumn(sessionInfo.columns, ["session_id", "sessionId"]);
        const lastUsedColumn = pickColumn(sessionInfo.columns, ["last_used_at", "lastUsedAt", "updated_at", "created_at"]);

        if (!sessionIdColumn) {
          throw new Error("Kolom session_id tidak ditemukan di tabel chat_sessions.");
        }

        const lastSeenExpression = timeColumn
          ? `coalesce(max(m.${quoteIdent(timeColumn)})::text, ${
              lastUsedColumn ? `cs.${quoteIdent(lastUsedColumn)}::text` : "null"
            })`
          : lastUsedColumn
            ? `cs.${quoteIdent(lastUsedColumn)}::text`
            : "null";
        const orderExpression = timeColumn
          ? `max(m.${quoteIdent(timeColumn)}) desc nulls last`
          : lastUsedColumn
            ? `cs.${quoteIdent(lastUsedColumn)} desc`
            : "";
        const joinCondition = `
          m.${quoteIdent(sessionColumn)}::text = cs.${quoteIdent(sessionIdColumn)}::text
          ${timeColumn ? `and ${timeCondition}` : ""}
        `;
        const searchCondition = search
          ? `where cs.${quoteIdent(sessionIdColumn)}::text ilike $${timeParams.length + 1}::text
              or m.message::text ilike $${timeParams.length + 1}::text`
          : "";
        const searchParams = search ? [`%${search}%`] : [];
        const limitParam = timeParams.length + searchParams.length + 1;
        const offsetParam = timeParams.length + searchParams.length + 2;

        const [countResult, sessions] = await Promise.all([
          client.query<{ total: number }>(
            `
              select count(*)::int as total
              from (
                select cs.${quoteIdent(sessionIdColumn)}
                from ${sessionInfo.table.sql} cs
                join ${info.table.sql} m on ${joinCondition}
                ${searchCondition}
                group by cs.${quoteIdent(sessionIdColumn)}
              ) filtered_sessions
            `,
            [...timeParams, ...searchParams]
          ),
          client.query<{ sessionId: string; total: number; lastSeen?: string }>(
            `
              select
                cs.${quoteIdent(sessionIdColumn)}::text as "sessionId",
                count(m.${quoteIdent(sessionColumn)}) filter (
                  where
                    lower(coalesce(m.message->>'type', m.message->>'role', '')) in ('human', 'user', 'question', 'input')
                    or lower(coalesce(m.message->>'type', m.message->>'role', '')) like '%human%'
                    or lower(coalesce(m.message->>'type', m.message->>'role', '')) like '%user%'
                    or lower(coalesce(m.message->>'type', m.message->>'role', '')) like '%question%'
                )::int as total,
                ${lastSeenExpression} as "lastSeen"
              from ${sessionInfo.table.sql} cs
              join ${info.table.sql} m on ${joinCondition}
              ${searchCondition}
              group by cs.${quoteIdent(sessionIdColumn)} ${lastUsedColumn ? `, cs.${quoteIdent(lastUsedColumn)}` : ""}
              ${orderExpression ? `order by ${orderExpression}` : ""}
              limit $${limitParam}::int offset $${offsetParam}::int
            `,
            [...timeParams, ...searchParams, limit, offset]
          )
        ]);
        const total = countResult.rows[0]?.total || 0;
        return {
          sessions: sessions.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1)
          }
        };
      }

      const result = await client.query<{ session_id: string; created_at?: string; raw: Record<string, unknown> }>(
        `
          select
            m.${quoteIdent(sessionColumn)}::text as session_id,
            ${timeColumn ? `m.${quoteIdent(timeColumn)}::text` : "null"} as created_at,
            ${rowsToJsonExpression("m", info.columns)} as raw
          from ${info.table.sql} m
          where m.${quoteIdent(sessionColumn)}::text = $${timeParams.length + 1}
            and ${timeCondition}
          ${timeColumn ? `order by m.${quoteIdent(timeColumn)} asc` : idColumn ? `order by m.${quoteIdent(idColumn)} asc` : ""}
          limit 1500
        `,
        [...timeParams, session]
      );

      const messages = result.rows
        .map((row) => ({
          sessionId: row.session_id,
          createdAt: row.created_at,
          ...normalizeMessage(row.raw)
        }))
        .filter((item) => !isInternalAgentMessage(item.role, item.content));

      const pairs = buildPairs(messages);
      const filteredPairs = search
        ? pairs.filter(
            (pair) =>
              pair.sessionId.toLowerCase().includes(search.toLowerCase()) ||
              pair.question.toLowerCase().includes(search.toLowerCase()) ||
              pair.answer.toLowerCase().includes(search.toLowerCase())
          )
        : pairs;
      const total = filteredPairs.length;
      const paginatedPairs = filteredPairs.slice(offset, offset + limit);

      return {
        session,
        messages,
        pairs: paginatedPairs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(Math.ceil(total / limit), 1)
        }
      };
    });

    if ("exportRows" in data && Array.isArray(data.exportRows)) {
      const excelBuffer = toExcelBuffer(data.exportRows);
      return new NextResponse(new Uint8Array(excelBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="ragas-chat-export-${filter.range}.xlsx"`
        }
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca chat.") }, { status: 500 });
  }
}
