import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
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

// Membangun file .xlsx asli (bukan CSV) agar:
//  - Teks jawaban chatbot yang mengandung baris baru tetap berada dalam SATU sel
//    (bukan terpecah jadi baris baru seperti yang terjadi di CSV).
//  - Baris yang diawali "-" (misalnya daftar program studi) tidak salah
//    dianggap formula oleh Excel (yang menyebabkan #NAME?), karena nilainya
//    ditulis sebagai string sel murni, bukan lewat parser teks.
function buildXlsxBuffer(sheetName: string, headers: string[], rows: Array<Array<unknown>>) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Lebar kolom otomatis (perkiraan) berdasarkan konten terpanjang, dibatasi biar tidak ekstrem
  const columnWidths = headers.map((header, colIndex) => {
    let maxLen = String(header).length;
    for (const row of rows) {
      const cell = row[colIndex];
      const text = cell === null || cell === undefined ? "" : String(cell);
      const firstLineLen = text.split("\n")[0].length;
      if (firstLineLen > maxLen) maxLen = firstLineLen;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
  });
  worksheet["!cols"] = columnWidths;

  // Aktifkan wrap text supaya sel multi-baris ditampilkan rapi, bukan satu baris panjang
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[address];
      if (!cell) continue;
      cell.s = cell.s || {};
      cell.s.alignment = { wrapText: true, vertical: "top" };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

function xlsxResponse(fileName: string, buffer: Buffer) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
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
  const exportType = url.searchParams.get("export") || "";

  const { start, end } = getDateRange(range, customStart, customEnd);

  try {
    // ─────────────────────────────────────────────────────────
    // MODE 0: ?export=ragas | ?export=data_leads → unduh CSV
    // ─────────────────────────────────────────────────────────
    if (exportType === "ragas" || exportType === "data_leads") {
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
      const joinClause = `
        FROM chat_history h
        LEFT JOIN chat_sessions cs ON cs.session_id = h.session_id
        LEFT JOIN visitors v ON v.visitor_uuid = cs.visitors_id
      `;

      if (exportType === "ragas") {
        const buffer = await withClient(async (client) => {
          const query = `
            SELECT 
              h.session_id AS session_id,
              h.question AS question,
              h.answer AS answer,
              h.context AS context,
              h.isfallback AS isfallback,
              h.time_start AS time_start,
              h.time_end AS time_end
            ${joinClause}
            ${whereClause}
            ORDER BY h.time_start ASC
          `;
          const res = await client.query(query, params);

          const rows = res.rows.map((row) => {
            let contextText = "";
            if (row.context !== null && row.context !== undefined) {
              contextText = typeof row.context === "string" ? row.context : JSON.stringify(row.context, null, 2);
            }
            return [
              row.session_id || "",
              row.question || "",
              row.answer || "",
              contextText,
              row.isfallback ? "true" : "false",
              row.time_start ? new Date(row.time_start).toISOString() : "",
              row.time_end ? new Date(row.time_end).toISOString() : ""
            ];
          });

          return buildXlsxBuffer(
            "RAGAS",
            ["session_id", "question", "answer", "context", "isfallback", "time_start", "time_end"],
            rows
          );
        });

        return xlsxResponse(`export-ragas-${new Date().toISOString()}.xlsx`, buffer);
      }

      // exportType === "data_leads"
      const buffer = await withClient(async (client) => {
        const query = `
          SELECT 
            h.session_id AS session_id,
            v.visitors_name AS visitor_name,
            v.visitors_phone_number AS visitor_phone_number,
            v.visitor_school_origin AS visitor_school_origin,
            COUNT(*) AS total_pertanyaan,
            MAX(h.time_start) AS last_seen
          ${joinClause}
          ${whereClause}
          GROUP BY h.session_id, v.visitors_name, v.visitors_phone_number, v.visitor_school_origin
          ORDER BY last_seen DESC
        `;
        const res = await client.query(query, params);

        const rows = res.rows.map((row) => [
          row.session_id || "",
          row.visitor_name || "",
          row.visitor_phone_number || "",
          row.visitor_school_origin || "",
          row.total_pertanyaan || 0,
          row.last_seen ? new Date(row.last_seen).toISOString() : ""
        ]);

        return buildXlsxBuffer(
          "Data Leads",
          ["session_id", "nama", "no_telepon", "asal_sekolah", "total_pertanyaan", "last_seen"],
          rows
        );
      });

      return xlsxResponse(`export-data_leads-${new Date().toISOString()}.xlsx`, buffer);
    }

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