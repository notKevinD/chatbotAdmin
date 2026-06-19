import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getCurrentAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import {
  addWibDays,
  getCurrentWibWallClock,
  getTimestampSqlCast,
  parseWibDateOnly,
  startOfWibDay,
  toStoredSqlTimestamp
} from "@/lib/report-time";
import * as XLSX from "xlsx";

type RangeName =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all"
  | "custom";

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
    requestedRange === "this_year" ||
    requestedRange === "all" ||
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

  if (range === "this_year") {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
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
    start,
    end,
    hasTimeFilter: range !== "all",
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

async function getOptionalColumns(client: PoolClient, tableName: string) {
  try {
    return await getColumns(client, tableName);
  } catch {
    return null;
  }
}

async function getChatSessionInfo(client: PoolClient) {
  const info = await getOptionalColumns(client, "chat_sessions");
  if (!info) return null;

  const sessionColumn = pickColumn(info.columns, ["session_id", "sessionId"]);
  if (!sessionColumn) return null;

  return {
    info,
    sessionColumn,
    visitorNameColumn: pickColumn(info.columns, ["visitor_name", "visitorName", "name"]),
    visitorPhoneColumn: pickColumn(info.columns, [
      "visitor_phone_number",
      "visitorPhoneNumber",
      "phone_number",
      "phone",
      "nomor_telepon",
      "no_telp"
    ]),
    visitorSchoolColumn: pickColumn(info.columns, [
      "visitor_school_origin",
      "visitorSchoolOrigin",
      "school_origin",
      "school",
      "asal_sekolah"
    ]),
    createdAtColumn: pickColumn(info.columns, ["created_at", "createdAt"]),
    lastUsedAtColumn: pickColumn(info.columns, ["last_used_at", "lastUsedAt", "updated_at"])
  };
}

function chatSessionLateralSql(
  chatSessionInfo: Awaited<ReturnType<typeof getChatSessionInfo>>,
  historySessionColumn: string
) {
  if (!chatSessionInfo) return "";

  const selectItems = [
    `${quoteIdent(chatSessionInfo.sessionColumn)}::text as session_id`,
    chatSessionInfo.visitorNameColumn
      ? `${quoteIdent(chatSessionInfo.visitorNameColumn)}::text as visitor_name`
      : "null::text as visitor_name",
    chatSessionInfo.visitorPhoneColumn
      ? `${quoteIdent(chatSessionInfo.visitorPhoneColumn)}::text as visitor_phone_number`
      : "null::text as visitor_phone_number",
    chatSessionInfo.visitorSchoolColumn
      ? `${quoteIdent(chatSessionInfo.visitorSchoolColumn)}::text as visitor_school_origin`
      : "null::text as visitor_school_origin",
    chatSessionInfo.createdAtColumn
      ? `${quoteIdent(chatSessionInfo.createdAtColumn)}::text as session_created_at`
      : "null::text as session_created_at",
    chatSessionInfo.lastUsedAtColumn
      ? `${quoteIdent(chatSessionInfo.lastUsedAtColumn)}::text as session_last_used_at`
      : "null::text as session_last_used_at"
  ];
  const orderSql = chatSessionInfo.lastUsedAtColumn
    ? `${quoteIdent(chatSessionInfo.lastUsedAtColumn)} desc nulls last`
    : chatSessionInfo.createdAtColumn
      ? `${quoteIdent(chatSessionInfo.createdAtColumn)} desc nulls last`
      : quoteIdent(chatSessionInfo.sessionColumn);

  return `
    left join lateral (
      select ${selectItems.join(", ")}
      from ${chatSessionInfo.info.table.sql} s
      where s.${quoteIdent(chatSessionInfo.sessionColumn)}::text = h.${quoteIdent(historySessionColumn)}::text
      order by ${orderSql}
      limit 1
    ) cs on true
  `;
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

function toExcelBuffer(rows: Array<Record<string, unknown>>, type: "ragas" | "data_leads") {
  const header =
    type === "data_leads"
      ? [
          "session_id",
          "visitor_name",
          "visitor_phone_number",
          "visitor_school_origin",
          "total_questions",
          "first_chat_at",
          "last_chat_at",
          "session_created_at",
          "session_last_used_at"
        ]
      : [
          "id",
          "session_id",
          "question",
          "answer",
          "context",
          "reference",
          "response_time_ms",
          "created_at"
        ];
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header
  });
  worksheet["!cols"] =
    type === "data_leads"
      ? [
          { wch: 38 },
          { wch: 28 },
          { wch: 22 },
          { wch: 34 },
          { wch: 16 },
          { wch: 24 },
          { wch: 24 },
          { wch: 24 },
          { wch: 24 }
        ]
      : [
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
  XLSX.utils.book_append_sheet(workbook, worksheet, type === "data_leads" ? "Data Leads" : "RAGAS Export");
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
        const timeStartColumnType = getColumnType(historyInfo.columns, timeStartColumn);
        const timeEndColumnType = getColumnType(historyInfo.columns, timeEndColumn);
        const timeSqlCast = getTimestampSqlCast(timeStartColumnType);
        const startSql = toStoredSqlTimestamp(filter.start, timeStartColumnType);
        const endSql = toStoredSqlTimestamp(filter.end, timeStartColumnType);
        const chatStartExpression = getChatStartExpression(
          timeStartColumn,
          timeEndColumn,
          timeStartColumnType,
          timeEndColumnType
        );

        if (!sessionColumn || !questionColumn || !answerColumn || !contextColumn) {
          throw new Error(
            "Tabel chat_history harus memiliki kolom session_id, question, answer, dan context."
          );
        }

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (timeStartColumn && filter.hasTimeFilter) {
          params.push(startSql, endSql);
          conditions.push(
            `${chatStartExpression} >= $1::${timeSqlCast} and ${chatStartExpression} < $2::${timeSqlCast}`
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
                round(extract(epoch from (h.${quoteIdent(timeEndColumn)} - (${chatStartExpression}))) * 1000)::bigint,
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
              ${timeStartColumn ? `(${chatStartExpression})::text` : "null"} as created_at
            from ${historyInfo.table.sql} h
            ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
            order by ${timeStartColumn ? chatStartExpression : idColumn ? `h.${quoteIdent(idColumn)}` : "1"} asc
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
          exportType: "ragas" as const,
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
      const fallbackColumn = pickColumn(historyInfo.columns, ["isfallback", "isFallback", "is_fallback"]);
      const timeStartColumnType = getColumnType(historyInfo.columns, timeStartColumn);
      const timeEndColumnType = getColumnType(historyInfo.columns, timeEndColumn);
      const timeSqlCast = getTimestampSqlCast(timeStartColumnType);
      const startSql = toStoredSqlTimestamp(filter.start, timeStartColumnType);
      const endSql = toStoredSqlTimestamp(filter.end, timeStartColumnType);
      const chatStartExpression = getChatStartExpression(
        timeStartColumn,
        timeEndColumn,
        timeStartColumnType,
        timeEndColumnType
      );
      const chatSessionInfo = await getChatSessionInfo(client);

      if (!sessionColumn || !questionColumn || !answerColumn) {
        throw new Error("Tabel chat_history harus memiliki kolom session_id, question, dan answer.");
      }

      const searchableColumns = [
        `h.${quoteIdent(sessionColumn)}::text`,
        `h.${quoteIdent(questionColumn)}::text`,
        `h.${quoteIdent(answerColumn)}::text`,
        contextColumn ? `h.${quoteIdent(contextColumn)}::text` : "",
        chatSessionInfo?.visitorNameColumn ? `cs.visitor_name` : "",
        chatSessionInfo?.visitorPhoneColumn ? `cs.visitor_phone_number` : "",
        chatSessionInfo?.visitorSchoolColumn ? `cs.visitor_school_origin` : ""
      ].filter(Boolean);

      if (exportType === "data_leads") {
        if (!chatSessionInfo) {
          throw new Error("Tabel chat_sessions dengan kolom session_id belum tersedia untuk ekspor data leads.");
        }

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (timeStartColumn && filter.hasTimeFilter) {
          params.push(startSql, endSql);
          conditions.push(
            `${chatStartExpression} >= $1::${timeSqlCast} and ${chatStartExpression} < $2::${timeSqlCast}`
          );
        }

        if (search) {
          params.push(`%${search}%`);
          const searchParam = `$${params.length}`;
          conditions.push(`(${searchableColumns.map((column) => `${column} ilike ${searchParam}::text`).join(" or ")})`);
        }

        const leadResult = await client.query<{
          session_id: string;
          visitor_name?: string;
          visitor_phone_number?: string;
          visitor_school_origin?: string;
          total_questions: number;
          first_chat_at?: string;
          last_chat_at?: string;
          session_created_at?: string;
          session_last_used_at?: string;
        }>(
          `
            select
              h.${quoteIdent(sessionColumn)}::text as session_id,
              max(cs.visitor_name) as visitor_name,
              max(cs.visitor_phone_number) as visitor_phone_number,
              max(cs.visitor_school_origin) as visitor_school_origin,
              count(*)::int as total_questions,
              ${timeStartColumn ? `min(${chatStartExpression})::text` : "null"} as first_chat_at,
              ${timeStartColumn ? `max(${chatStartExpression})::text` : "null"} as last_chat_at,
              max(cs.session_created_at) as session_created_at,
              max(cs.session_last_used_at) as session_last_used_at
            from ${historyInfo.table.sql} h
            ${chatSessionLateralSql(chatSessionInfo, sessionColumn)}
            ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
            group by h.${quoteIdent(sessionColumn)}
            order by ${timeStartColumn ? `max(${chatStartExpression}) desc nulls last` : "session_id"}
            limit 10000
          `,
          params
        );

        await writeAuditLog({
          request,
          userId: admin.id,
          action: "export_chat_data_leads",
          detail: { range: filter.range, search, total: leadResult.rows.length }
        });

        return {
          exportType: "data_leads" as const,
          exportRows: leadResult.rows.map((row) => ({
            session_id: row.session_id,
            visitor_name: row.visitor_name || "",
            visitor_phone_number: row.visitor_phone_number || "",
            visitor_school_origin: row.visitor_school_origin || "",
            total_questions: row.total_questions,
            first_chat_at: row.first_chat_at || "",
            last_chat_at: row.last_chat_at || "",
            session_created_at: row.session_created_at || "",
            session_last_used_at: row.session_last_used_at || ""
          }))
        };
      }

      if (!session) {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (timeStartColumn && filter.hasTimeFilter && !includeAll) {
          params.push(startSql, endSql);
          conditions.push(
            `${chatStartExpression} >= $1::${timeSqlCast} and ${chatStartExpression} < $2::${timeSqlCast}`
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
          ? `max(${chatStartExpression})::text`
          : idColumn
            ? `max(h.${quoteIdent(idColumn)})::text`
            : "null";
        const orderExpression = timeStartColumn
          ? `max(${chatStartExpression}) desc nulls last`
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
                ${chatSessionLateralSql(chatSessionInfo, sessionColumn)}
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
                ${lastSeenExpression} as "lastSeen",
                ${chatSessionInfo ? "max(cs.visitor_name)" : "null"} as "visitorName",
                ${chatSessionInfo ? "max(cs.visitor_phone_number)" : "null"} as "visitorPhoneNumber",
                ${chatSessionInfo ? "max(cs.visitor_school_origin)" : "null"} as "visitorSchoolOrigin"
              from ${historyInfo.table.sql} h
              ${chatSessionLateralSql(chatSessionInfo, sessionColumn)}
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

      if (timeStartColumn && filter.hasTimeFilter && !includeAll) {
        params.push(startSql, endSql);
        conditions.push(
          `${chatStartExpression} >= $2::${timeSqlCast} and ${chatStartExpression} < $3::${timeSqlCast}`
        );
      }

      if (search) {
        params.push(`%${search}%`);
        const searchParam = `$${params.length}`;
        conditions.push(`(${searchableColumns.map((column) => `${column} ilike ${searchParam}::text`).join(" or ")})`);
      }

      const whereSql = `where ${conditions.join(" and ")}`;
      const countResult = await client.query<{ total: number }>(
        `
          select count(*)::int as total
          from ${historyInfo.table.sql} h
          ${chatSessionLateralSql(chatSessionInfo, sessionColumn)}
          ${whereSql}
        `,
        params
      );
      const total = countResult.rows[0]?.total || 0;
      const limitParam = params.length + 1;
      const offsetParam = params.length + 2;
      const responseTimeExpression =
        timeStartColumn && timeEndColumn
          ? `greatest(
              round(extract(epoch from (h.${quoteIdent(timeEndColumn)} - (${chatStartExpression}))))::bigint,
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
        isFallback?: boolean;
        visitorName?: string;
        visitorPhoneNumber?: string;
        visitorSchoolOrigin?: string;
      }>(
        `
          select
            ${idColumn ? `h.${quoteIdent(idColumn)}::text` : "null"} as id,
            h.${quoteIdent(sessionColumn)}::text as "sessionId",
            h.${quoteIdent(questionColumn)}::text as question,
            h.${quoteIdent(answerColumn)}::text as answer,
            ${contextColumn ? `h.${quoteIdent(contextColumn)}` : "'[]'::jsonb"} as context,
            ${timeStartColumn ? `(${chatStartExpression})::text` : "null"} as "createdAt",
            ${responseTimeExpression} as "responseTimeMs",
            ${fallbackColumn ? `coalesce(h.${quoteIdent(fallbackColumn)}, false)` : "false"} as "isFallback",
            ${chatSessionInfo ? "cs.visitor_name" : "null"} as "visitorName",
            ${chatSessionInfo ? "cs.visitor_phone_number" : "null"} as "visitorPhoneNumber",
            ${chatSessionInfo ? "cs.visitor_school_origin" : "null"} as "visitorSchoolOrigin"
          from ${historyInfo.table.sql} h
          ${chatSessionLateralSql(chatSessionInfo, sessionColumn)}
          ${whereSql}
          order by ${
            timeStartColumn
              ? `${chatStartExpression} asc`
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
      const exportKind = data.exportType === "data_leads" ? "data_leads" : "ragas";
      const excelBuffer = toExcelBuffer(data.exportRows, exportKind);
      const filename =
        exportKind === "data_leads"
          ? `data-leads-export-${filter.range}.xlsx`
          : `ragas-data-export-${filter.range}.xlsx`;
      return new NextResponse(new Uint8Array(excelBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`
        }
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal membaca chat.") }, { status: 500 });
  }
}
