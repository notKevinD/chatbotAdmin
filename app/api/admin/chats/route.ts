import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import {
  addWibDays,
  getCurrentWibWallClock,
  parseWibDateOnly,
  startOfWibDay,
  toStoredSqlTimestamp
} from "@/lib/report-time";
import * as XLSX from "xlsx";

type RangeName = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

function addDays(date: Date, days: number) {
  return addWibDays(date, days);
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

  return {
    range,
    startSql: toStoredSqlTimestamp(start),
    endSql: toStoredSqlTimestamp(end)
  };
}

function toExcelBuffer(rows: Array<Record<string, unknown>>) {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      "id",
      "session_id",
      "question",
      "answer",
      "context",
      "reference",
      "response_time_ms",
      "created_at"
    ]
  });
  worksheet["!cols"] = [
    { wch: 10 },
    { wch: 38 },
    { wch: 52 },
    { wch: 64 },
    { wch: 100 },
    { wch: 64 },
    { wch: 20 },
    { wch: 24 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "RAGAS Export");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function contextToExcel(value: unknown) {
  if (value == null) return "[]";

  if (typeof value === "string") {
    try {
      return contextToExcel(JSON.parse(value));
    } catch {
      return JSON.stringify([value]);
    }
  }

  const source =
    value && typeof value === "object" && !Array.isArray(value) && "retrieved_contexts" in value
      ? (value as { retrieved_contexts?: unknown }).retrieved_contexts
      : value;
  const items = Array.isArray(source) ? source : [source];
  const contexts = items
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return String(item ?? "");

      const record = item as Record<string, unknown>;
      const pageContent = record.pageContent ?? record.page_content ?? record.content ?? record.text;
      return typeof pageContent === "string" ? pageContent : JSON.stringify(record);
    })
    .filter(Boolean);

  return JSON.stringify(contexts);
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const session = url.searchParams.get("session");
  const exportType = url.searchParams.get("export");
  const includeAll = url.searchParams.get("all") === "true";
  const search = (url.searchParams.get("q") || "").trim();
  const filter = getFilter(url.searchParams);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "10"), 1), 100);
  const offset = (page - 1) * limit;

  try {
    const data = await withClient(async (client) => {
      if (exportType === "ragas") {
        const historyInfo = await getColumns(client, "chat_history");
        const idColumn = pickColumn(historyInfo.columns, ["id"]);
        const sessionColumn = pickColumn(historyInfo.columns, ["session_id", "sessionId"]);
        const questionColumn = pickColumn(historyInfo.columns, ["question"]);
        const answerColumn = pickColumn(historyInfo.columns, ["answer"]);
        const contextColumn = pickColumn(historyInfo.columns, ["context"]);
        const timeStartColumn = pickColumn(historyInfo.columns, ["time_start", "started_at", "created_at"]);
        const timeEndColumn = pickColumn(historyInfo.columns, ["time_end", "ended_at", "completed_at"]);

        if (!sessionColumn || !questionColumn || !answerColumn || !contextColumn) {
          throw new Error(
            "Tabel chat_history harus memiliki kolom session_id, question, answer, dan context."
          );
        }

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (timeStartColumn) {
          params.push(filter.startSql, filter.endSql);
          conditions.push(
            `h.${quoteIdent(timeStartColumn)} >= $1::timestamp and h.${quoteIdent(timeStartColumn)} < $2::timestamp`
          );
        }

        if (search) {
          params.push(`%${search}%`);
          const searchParam = `$${params.length}`;
          conditions.push(
            `(h.${quoteIdent(sessionColumn)}::text ilike ${searchParam}::text
              or h.${quoteIdent(questionColumn)} ilike ${searchParam}::text
              or h.${quoteIdent(answerColumn)} ilike ${searchParam}::text
              or h.${quoteIdent(contextColumn)}::text ilike ${searchParam}::text)`
          );
        }

        const responseTimeExpression =
          timeStartColumn && timeEndColumn
            ? `greatest(
                round(extract(epoch from (h.${quoteIdent(timeEndColumn)} - h.${quoteIdent(timeStartColumn)})) * 1000)::bigint,
                0
              )`
            : "null";
        const result = await client.query<{
          id?: string | number;
          session_id: string;
          question: string;
          answer: string;
          context: unknown;
          response_time_ms?: number;
          created_at?: string;
        }>(
          `
            select
              ${idColumn ? `h.${quoteIdent(idColumn)}::text` : "null"} as id,
              h.${quoteIdent(sessionColumn)}::text as session_id,
              h.${quoteIdent(questionColumn)}::text as question,
              h.${quoteIdent(answerColumn)}::text as answer,
              h.${quoteIdent(contextColumn)} as context,
              ${responseTimeExpression} as response_time_ms,
              ${timeStartColumn ? `h.${quoteIdent(timeStartColumn)}::text` : "null"} as created_at
            from ${historyInfo.table.sql} h
            ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
            order by ${timeStartColumn ? `h.${quoteIdent(timeStartColumn)}` : idColumn ? `h.${quoteIdent(idColumn)}` : "1"} asc
            limit 10000
          `,
          params
        );

        await writeAuditLog({
          request,
          userId: admin.id,
          action: "export_chat_history_ragas",
          detail: { range: filter.range, search, total: result.rows.length }
        });

        return {
          exportRows: result.rows.map((row) => ({
            id: row.id ?? "",
            session_id: row.session_id,
            question: row.question,
            answer: row.answer,
            context: contextToExcel(row.context),
            reference: "",
            response_time_ms: row.response_time_ms ?? "",
            created_at: row.created_at || ""
          }))
        };
      }

      const historyInfo = await getColumns(client, "chat_history");
      const idColumn = pickColumn(historyInfo.columns, ["id"]);
      const sessionColumn = pickColumn(historyInfo.columns, ["session_id", "sessionId"]);
      const questionColumn = pickColumn(historyInfo.columns, ["question"]);
      const answerColumn = pickColumn(historyInfo.columns, ["answer"]);
      const contextColumn = pickColumn(historyInfo.columns, ["context"]);
      const timeStartColumn = pickColumn(historyInfo.columns, ["time_start", "started_at", "created_at"]);
      const timeEndColumn = pickColumn(historyInfo.columns, ["time_end", "ended_at", "completed_at"]);

      if (!sessionColumn || !questionColumn || !answerColumn) {
        throw new Error("Tabel chat_history harus memiliki kolom session_id, question, dan answer.");
      }

      const searchableColumns = [
        `h.${quoteIdent(sessionColumn)}::text`,
        `h.${quoteIdent(questionColumn)}::text`,
        `h.${quoteIdent(answerColumn)}::text`,
        contextColumn ? `h.${quoteIdent(contextColumn)}::text` : ""
      ].filter(Boolean);

      if (!session) {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (timeStartColumn && !includeAll) {
          params.push(filter.startSql, filter.endSql);
          conditions.push(
            `h.${quoteIdent(timeStartColumn)} >= $1::timestamp and h.${quoteIdent(timeStartColumn)} < $2::timestamp`
          );
        }

        if (search) {
          params.push(`%${search}%`);
          const searchParam = `$${params.length}`;
          conditions.push(`(${searchableColumns.map((column) => `${column} ilike ${searchParam}::text`).join(" or ")})`);
        }

        const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
        const limitParam = params.length + 1;
        const offsetParam = params.length + 2;
        const lastSeenExpression = timeStartColumn
          ? `max(h.${quoteIdent(timeStartColumn)})::text`
          : idColumn
            ? `max(h.${quoteIdent(idColumn)})::text`
            : "null";
        const orderExpression = timeStartColumn
          ? `max(h.${quoteIdent(timeStartColumn)}) desc nulls last`
          : idColumn
            ? `max(h.${quoteIdent(idColumn)}) desc`
            : `"sessionId"`;

        const [countResult, sessionResult] = await Promise.all([
          client.query<{ total: number }>(
            `
              select count(*)::int as total
              from (
                select h.${quoteIdent(sessionColumn)}
                from ${historyInfo.table.sql} h
                ${whereSql}
                group by h.${quoteIdent(sessionColumn)}
              ) filtered_sessions
            `,
            params
          ),
          client.query<{ sessionId: string; total: number; lastSeen?: string }>(
            `
              select
                h.${quoteIdent(sessionColumn)}::text as "sessionId",
                count(*)::int as total,
                ${lastSeenExpression} as "lastSeen"
              from ${historyInfo.table.sql} h
              ${whereSql}
              group by h.${quoteIdent(sessionColumn)}
              order by ${orderExpression}
              limit $${limitParam}::int offset $${offsetParam}::int
            `,
            [...params, limit, offset]
          )
        ]);
        const total = countResult.rows[0]?.total || 0;

        return {
          sessions: sessionResult.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1)
          }
        };
      }

      const conditions: string[] = [];
      const params: unknown[] = [session];
      conditions.push(`h.${quoteIdent(sessionColumn)}::text = $1::text`);

      if (timeStartColumn && !includeAll) {
        params.push(filter.startSql, filter.endSql);
        conditions.push(
          `h.${quoteIdent(timeStartColumn)} >= $2::timestamp and h.${quoteIdent(timeStartColumn)} < $3::timestamp`
        );
      }

      if (search) {
        params.push(`%${search}%`);
        const searchParam = `$${params.length}`;
        conditions.push(`(${searchableColumns.map((column) => `${column} ilike ${searchParam}::text`).join(" or ")})`);
      }

      const whereSql = `where ${conditions.join(" and ")}`;
      const countResult = await client.query<{ total: number }>(
        `select count(*)::int as total from ${historyInfo.table.sql} h ${whereSql}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;
      const limitParam = params.length + 1;
      const offsetParam = params.length + 2;
      const responseTimeExpression =
        timeStartColumn && timeEndColumn
          ? `greatest(
              round(extract(epoch from (h.${quoteIdent(timeEndColumn)} - h.${quoteIdent(timeStartColumn)})) * 1000)::bigint,
              0
            )`
          : "null";

      const historyResult = await client.query<{
        id?: string;
        sessionId: string;
        question: string;
        answer: string;
        context?: unknown;
        createdAt?: string;
        responseTimeMs?: number;
      }>(
        `
          select
            ${idColumn ? `h.${quoteIdent(idColumn)}::text` : "null"} as id,
            h.${quoteIdent(sessionColumn)}::text as "sessionId",
            h.${quoteIdent(questionColumn)}::text as question,
            h.${quoteIdent(answerColumn)}::text as answer,
            ${contextColumn ? `h.${quoteIdent(contextColumn)}` : "'[]'::jsonb"} as context,
            ${timeStartColumn ? `h.${quoteIdent(timeStartColumn)}::text` : "null"} as "createdAt",
            ${responseTimeExpression} as "responseTimeMs"
          from ${historyInfo.table.sql} h
          ${whereSql}
          order by ${
            timeStartColumn
              ? `h.${quoteIdent(timeStartColumn)} asc`
              : idColumn
                ? `h.${quoteIdent(idColumn)} asc`
                : `h.${quoteIdent(sessionColumn)} asc`
          }
          ${includeAll ? "limit 10000" : `limit $${limitParam}::int offset $${offsetParam}::int`}
        `,
        includeAll ? params : [...params, limit, offset]
      );

      return {
        session,
        pairs: historyResult.rows,
        pagination: {
          page: includeAll ? 1 : page,
          limit: includeAll ? Math.max(total, 1) : limit,
          total,
          totalPages: includeAll ? 1 : Math.max(Math.ceil(total / limit), 1)
        }
      };
    });

    if ("exportRows" in data && Array.isArray(data.exportRows)) {
      const excelBuffer = toExcelBuffer(data.exportRows);
      return new NextResponse(new Uint8Array(excelBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="ragas-data-export-${filter.range}.xlsx"`
        }
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca chat.") }, { status: 500 });
  }
}
