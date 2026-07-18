import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import { toStoredSqlTimestamp, getTimestampSqlCast } from "@/lib/report-time";

function getFilterFromUrl(urlStr: string) {
  const searchParams = new URL(urlStr).searchParams;
  const requestedRange = searchParams.get("range");
  
  // Memberikan fallback aman agar range waktu tidak kosong dan memicu Bad Request 400
  const range = (requestedRange === "today" ||
    requestedRange === "yesterday" ||
    requestedRange === "this_week" ||
    requestedRange === "last_week" ||
    requestedRange === "this_month" ||
    requestedRange === "last_month" ||
    requestedRange === "this_year" ||
    requestedRange === "all" ||
    requestedRange === "custom") ? requestedRange : "this_week";

  return { range };
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

  const { range } = getFilterFromUrl(request.url);

  try {
    const data = await withClient(async (client) => {
      // 1. Deteksi skema tabel chat secara dinamis
      const chatTableInfo = await getColumns(client, "chat_sessions").catch(async () => {
        return await getColumns(client, "sessions");
      });

      const idColumn = pickColumn(chatTableInfo.columns, ["id", "session_id", "sessionId"]);
      const userColumn = pickColumn(chatTableInfo.columns, ["user_id", "user_identifier", "phone", "email", "name", "visitor_name"]);
      const schoolColumn = pickColumn(chatTableInfo.columns, ["school", "school_origin", "visitor_school_origin", "school_name"]);
      const updatedColumn = pickColumn(chatTableInfo.columns, ["updated_at", "updatedAt", "created_at", "last_seen"]);

      if (!idColumn) {
        throw new Error("Kolom identitas unik (ID) tidak ditemukan di tabel chat.");
      }

      // 2. Bangun kondisi pencarian search kata kunci jika diinput admin
      let whereClause = "where 1=1";
      const queryParams: any[] = [];

      if (search) {
        queryParams.push(`%${search}%`);
        whereClause += ` and (${userColumn ? `${quoteIdent(userColumn)}::text ilike $1` : "1=1"})`;
      }

      // 3. Eksekusi hitung total rows menggunakan DISTINCT untuk grup sesi yang unik
      const countRes = await client.query(
        `select count(distinct ${quoteIdent(idColumn)})::int as total from ${chatTableInfo.table.sql} ${whereClause}`,
        queryParams
      );
      const totalRows = countRes.rows[0]?.total || 0;

      const limitIndex = queryParams.length + 1;
      const offsetIndex = queryParams.length + 2;
      queryParams.push(limit, offset);

      // 4. Ambil data dengan alias camelCase yang didukung penuh oleh komponen ChatPanel.tsx Anda
      const sessionsRes = await client.query(
        `
          select 
            distinct on (${quoteIdent(idColumn)})
            ${quoteIdent(idColumn)}::text as id,
            ${quoteIdent(idColumn)}::text as "sessionId",
            ${quoteIdent(idColumn)}::text as session_id,
            ${userColumn ? `${quoteIdent(userColumn)}::text` : "'Calon Mahasiswa'"} as "visitorName",
            ${userColumn ? `${quoteIdent(userColumn)}::text` : "'Calon Mahasiswa'"} as name,
            ${schoolColumn ? `${quoteIdent(schoolColumn)}::text` : "'Sekolah Umum'"} as "visitorSchoolOrigin",
            count(*) over (partition by ${quoteIdent(idColumn)})::int as total,
            ${updatedColumn ? `${quoteIdent(updatedColumn)}::text` : "now()::text"} as "lastSeen",
            ${updatedColumn ? `${quoteIdent(updatedColumn)}::text` : "now()::text"} as updated_at
          from ${chatTableInfo.table.sql}
          ${whereClause}
          order by ${quoteIdent(idColumn)} asc, ${updatedColumn ? quoteIdent(updatedColumn) : "1"} desc
          limit $${limitIndex}::int offset $${offsetIndex}::int
        `,
        queryParams
      );

      return {
        sessions: sessionsRes.rows,
        pagination: { page, limit, totalRows, totalPages: Math.ceil(totalRows / limit) }
      };
    });

    return NextResponse.json(data);

  } catch (error) {
    console.error("Error pada API Get Chats:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat riwayat obrolan dari database.") }, 
      { status: 500 }
    );
  }
}