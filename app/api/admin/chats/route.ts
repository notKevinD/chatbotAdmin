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
  const sessionId = url.searchParams.get("session")?.trim() || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.max(1, Number(url.searchParams.get("limit") || 10));
  const offset = (page - 1) * limit;
  const search = url.searchParams.get("q")?.trim() || "";
  const range = url.searchParams.get("range") as Range || "this_week";
  const customStart = url.searchParams.get("startDate") || "";
  const customEnd = url.searchParams.get("endDate") || "";
  const wantsAll = url.searchParams.get("all") === "true";

  try {
    // ─────────────────────────────────────────────────────────
    // MODE 1: ?session=... → kembalikan pairs (percakapan) + leadInfo
    // untuk satu session tertentu (dipakai oleh dashboard.tsx & chat-panel.tsx)
    // ─────────────────────────────────────────────────────────
    if (sessionId) {
      const data = await withClient(async (client) => {
        const query = `
          SELECT 
            h.question AS question,
            h.answer AS answer,
            h.time_start AS "createdAt",
            h.time_end AS "timeEnd",
            h.isfallback AS "isFallback",
            h.context AS context,
            v.visitors_name AS "visitorName",
            v.visitors_phone_number AS "visitorPhoneNumber",
            v.visitor_school_origin AS "visitorSchoolOrigin"
          FROM chat_history h
          LEFT JOIN chat_sessions cs ON cs.session_id = h.session_id
          LEFT JOIN visitors v ON v.visitor_uuid = cs.visitors_id
          WHERE h.session_id = $1
          ORDER BY h.time_start ASC
        `;
        const res = await client.query(query, [sessionId]);
        const rows = res.rows || [];

        const allPairs = rows.map((row) => {
          let responseTimeMs = 0;
          if (row.createdAt && row.timeEnd) {
            const s = new Date(row.createdAt).getTime();
            const e = new Date(row.timeEnd).getTime();
            responseTimeMs = Math.max(0, e - s);
          }
          return {
            question: row.question || "-",
            answer: row.answer || "-",
            createdAt: row.createdAt || new Date().toISOString(),
            responseTimeMs,
            isFallback: row.isFallback || false,
            context: row.context || "[]",
            visitorName: row.visitorName || "Calon Mahasiswa",
            visitorPhoneNumber: row.visitorPhoneNumber || "-",
            visitorSchoolOrigin: row.visitorSchoolOrigin || "-",
          };
        });

        const totalRows = allPairs.length;
        const pagedPairs = wantsAll ? allPairs : allPairs.slice(offset, offset + limit);

        return {
          pairs: pagedPairs,
          pagination: {
            page,
            limit,
            total: totalRows,
            totalPages: Math.max(Math.ceil(totalRows / limit), 1),
          },
        };
      });

      return NextResponse.json(data);
    }

    // ─────────────────────────────────────────────────────────
    // MODE 2: tanpa ?session → daftar session (grouped), dipakai admin-app.tsx
    // ─────────────────────────────────────────────────────────
    const { start, end } = getDateRange(range, customStart, customEnd);

    const data = await withClient(async (client) => {
      const joinClause = `
        FROM chat_history h
        LEFT JOIN chat_sessions cs ON cs.session_id = h.session_id
        LEFT JOIN visitors v ON v.visitor_uuid = cs.visitors_id
      `;

      const conditions: string[] = [];
      const params: any[] = [];

      if (start && end) {
        params.push(start, end);
        conditions.push(`h.time_start BETWEEN $${params.length - 1} AND $${params.length}`);
      }

      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(v.visitors_name::text ILIKE $${params.length} OR h.question::text ILIKE $${params.length} OR h.answer::text ILIKE $${params.length})`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const countQuery = `
        SELECT COUNT(DISTINCT h.session_id)::int AS total
        ${joinClause}
        ${whereClause}
      `;
      const countRes = await client.query(countQuery, params);
      const totalRows = countRes.rows[0]?.total || 0;

      const dataQuery = `
        WITH ranked AS (
          SELECT 
            h.session_id AS session_id_val,
            v.visitors_name AS "visitorName",
            v.visitor_school_origin AS "visitorSchoolOrigin",
            h.time_start AS "lastSeen",
            COUNT(*) OVER (PARTITION BY h.session_id) AS total_messages,
            ROW_NUMBER() OVER (PARTITION BY h.session_id ORDER BY h.time_start DESC) AS rn
          ${joinClause}
          ${whereClause}
        )
        SELECT 
          session_id_val AS "sessionId",
          session_id_val AS session_id,
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