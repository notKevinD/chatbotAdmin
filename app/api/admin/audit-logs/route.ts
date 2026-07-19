import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 20)), 100);
  const offset = (page - 1) * limit;
  const actionFilter = url.searchParams.get("action")?.trim() || "";

  try {
    const data = await withClient(async (client) => {
      const info = await getColumns(client, "admin_audit_logs");
      const idColumn = pickColumn(info.columns, ["id"]);
      const userIdColumn = pickColumn(info.columns, ["user_id", "userId"]);
      const actionColumn = pickColumn(info.columns, ["action"]);
      const detailColumn = pickColumn(info.columns, ["detail", "details", "metadata"]);
      const ipColumn = pickColumn(info.columns, ["ip_address", "ipAddress", "ip"]);
      const userAgentColumn = pickColumn(info.columns, ["user_agent", "userAgent"]);
      const createdColumn = pickColumn(info.columns, ["created_at", "createdAt", "timestamp", "time"]);

      if (!actionColumn) {
        throw new Error("Kolom 'action' tidak ditemukan di tabel admin_audit_logs.");
      }

      // Coba join ke admin_users untuk dapat nama/email admin yang jelas
      // (bukan cuma UUID) — kalau tabelnya tidak ada/tidak cocok, tetap
      // jalan tanpa join (fallback aman).
      let joinClause = "";
      let adminNameExpr = "null";
      let adminEmailExpr = "null";
      if (userIdColumn) {
        try {
          const usersInfo = await getColumns(client, "admin_users");
          const usersIdColumn = pickColumn(usersInfo.columns, ["id"]);
          const usersNameColumn = pickColumn(usersInfo.columns, ["name", "full_name"]);
          const usersEmailColumn = pickColumn(usersInfo.columns, ["email"]);
          if (usersIdColumn) {
            joinClause = `LEFT JOIN ${usersInfo.table.sql} u ON u.${quoteIdent(usersIdColumn)}::text = l.${quoteIdent(userIdColumn)}::text`;
            adminNameExpr = usersNameColumn ? `u.${quoteIdent(usersNameColumn)}` : "null";
            adminEmailExpr = usersEmailColumn ? `u.${quoteIdent(usersEmailColumn)}` : "null";
          }
        } catch {
          // admin_users tidak ditemukan/beda skema — lanjut tanpa join
        }
      }

      const whereClause = actionFilter ? `WHERE l.${quoteIdent(actionColumn)}::text ILIKE $1::text` : "";
      const params = actionFilter ? [`%${actionFilter}%`] : [];

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM ${info.table.sql} l ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      const dataResult = await client.query(
        `
          SELECT
            ${idColumn ? `l.${quoteIdent(idColumn)}::text` : "null"} AS id,
            l.${quoteIdent(actionColumn)}::text AS action,
            ${detailColumn ? `l.${quoteIdent(detailColumn)}` : "null"} AS detail,
            ${ipColumn ? `l.${quoteIdent(ipColumn)}::text` : "null"} AS ip_address,
            ${userAgentColumn ? `l.${quoteIdent(userAgentColumn)}::text` : "null"} AS user_agent,
            ${createdColumn ? `l.${quoteIdent(createdColumn)}::text` : "null"} AS created_at,
            ${adminNameExpr} AS admin_name,
            ${adminEmailExpr} AS admin_email
          FROM ${info.table.sql} l
          ${joinClause}
          ${whereClause}
          ORDER BY ${createdColumn ? `l.${quoteIdent(createdColumn)} DESC` : `1 DESC`}
          LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int
        `,
        [...params, limit, offset]
      );

      return {
        rows: dataResult.rows,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat log aktivitas admin.") },
      { status: 500 }
    );
  }
}