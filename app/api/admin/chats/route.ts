import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, withClient } from "@/lib/db";

type Range = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "all" | "custom";

function getDateRange(range: Range, customStart?: string, customEnd?: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = null;

  const setStartEnd = (s: Date, e: Date) => {
    start = s;
    end = e;
  };

  switch (range) {
    case "today": {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "yesterday": {
      const s = new Date(now);
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(e.getDate() - 1);
      e.setHours(23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "this_week": {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const s = new Date(now);
      s.setDate(diff);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(diff + 6);
      e.setHours(23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "last_week": {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
      const s = new Date(now);
      s.setDate(diff);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(diff + 6);
      e.setHours(23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "this_month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "last_month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "this_year": {
      const s = new Date(now.getFullYear(), 0, 1);
      const e = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      setStartEnd(s, e);
      break;
    }
    case "custom": {
      if (customStart && customEnd) {
        start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
      }
      break;
    }
    case "all":
    default:
      start = null;
      end = null;
      break;
  }
  return { start, end };
}

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.max(1, Number(url.searchParams.get("limit") || 10));
  const offset = (page - 1) * limit;
  const search = url.searchParams.get("q")?.trim() || "";
  const range = url.searchParams.get("range") as Range || "this_week";
  const customStart = url.searchParams.get("startDate") || "";
  const customEnd = url.searchParams.get("endDate") || "";

  const { start, end } = getDateRange(range, customStart, customEnd);

  try {
    const data = await withClient(async (client) => {
      // Hardcode nama tabel & kolom – sesuaikan dengan skema Anda
      const table = "chat_history";
      const idCol = "session_id";
      const visitorNameCol = "visitor_name";
      const schoolCol = "school_origin";
      const updatedCol = "time_start";
      const questionCol = "question";
      const answerCol = "answer";

      const conditions: string[] = [];
      const params: any[] = [];

      if (start && end) {
        params.push(start, end);
        conditions.push(`${updatedCol} BETWEEN $${params.length - 1} AND $${params.length}`);
      }

      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(${visitorNameCol}::text ILIKE $${params.length} OR ${questionCol}::text ILIKE $${params.length} OR ${answerCol}::text ILIKE $${params.length})`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countQuery = `
        SELECT COUNT(DISTINCT ${idCol})::int AS total
        FROM ${table}
        ${whereClause}
      `;
      const countRes = await client.query(countQuery, params);
      const totalRows = countRes.rows[0]?.total || 0;

      const dataQuery = `
        WITH ranked AS (
          SELECT 
            ${idCol},
            ${visitorNameCol} AS "visitorName",
            ${schoolCol} AS "visitorSchoolOrigin",
            ${updatedCol} AS "lastSeen",
            COUNT(*) OVER (PARTITION BY ${idCol}) AS total_messages,
            ROW_NUMBER() OVER (PARTITION BY ${idCol} ORDER BY ${updatedCol} DESC) AS rn
          FROM ${table}
          ${whereClause}
        )
        SELECT 
          ${idCol} AS "sessionId",
          ${idCol} AS session_id,
          "visitorName",
          "visitorSchoolOrigin",
          "lastSeen",
          total_messages AS total
        FROM ranked
        WHERE rn = 1
        ORDER BY "lastSeen" DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      const dataParams = [...params, limit, offset];
      const sessionsRes = await client.query(dataQuery, dataParams);

      return {
        sessions: sessionsRes.rows,
        pagination: {
          page,
          limit,
          totalRows,
          totalPages: Math.ceil(totalRows / limit),
        },
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error pada API Get Chats:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat riwayat obrolan.") },
      { status: 500 }
    );
  }
}