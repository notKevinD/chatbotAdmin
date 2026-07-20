import { NextResponse } from "next/server";
import { getCurrentAdmin, getCurrentSessionTokenHash, isSuperAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const restrictToSelf = !isSuperAdmin(admin);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 20)), 100);
  const offset = (page - 1) * limit;

  try {
    const currentTokenHash = await getCurrentSessionTokenHash();

    const { rows, total } = await withClient(async (client) => {
      const info = await getColumns(client, "admin_sessions");
      const idColumn = pickColumn(info.columns, ["id"]);
      const userIdColumn = pickColumn(info.columns, ["user_id", "userId"]);
      const tokenHashColumn = pickColumn(info.columns, ["session_token_hash", "token_hash"]);
      const ipColumn = pickColumn(info.columns, ["ip_address", "ipAddress", "ip"]);
      const userAgentColumn = pickColumn(info.columns, ["user_agent", "userAgent"]);
      const createdColumn = pickColumn(info.columns, ["created_at", "createdAt"]);
      const lastUsedColumn = pickColumn(info.columns, ["last_used_at", "lastUsedAt"]);
      const expiresColumn = pickColumn(info.columns, ["expires_at", "expiresAt"]);

      if (!idColumn || !tokenHashColumn) {
        throw new Error("Kolom id/session_token_hash tidak ditemukan di tabel admin_sessions.");
      }
      // Admin biasa cuma boleh lihat sesi miliknya sendiri; super admin
      // lihat semua sesi semua admin. Ini pengecekan wajib di server —
      // jangan cuma difilter di frontend.
      if (restrictToSelf && !userIdColumn) {
        throw new Error("Kolom user_id tidak ditemukan di tabel admin_sessions.");
      }

      // Join ke admin_users supaya tampil nama/email admin pemilik sesi,
      // bukan cuma UUID mentah — kalau gagal (skema beda), tetap jalan
      // tanpa join.
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
            joinClause = `LEFT JOIN ${usersInfo.table.sql} u ON u.${quoteIdent(usersIdColumn)}::text = s.${quoteIdent(userIdColumn)}::text`;
            adminNameExpr = usersNameColumn ? `u.${quoteIdent(usersNameColumn)}` : "null";
            adminEmailExpr = usersEmailColumn ? `u.${quoteIdent(usersEmailColumn)}` : "null";
          }
        } catch {
          // admin_users tidak ditemukan/beda skema — lanjut tanpa join
        }
      }

      const whereClauses: string[] = [];
      const params: string[] = [];
      if (expiresColumn) whereClauses.push(`s.${quoteIdent(expiresColumn)} > now()`);
      if (restrictToSelf && userIdColumn) {
        params.push(admin.id);
        whereClauses.push(`s.${quoteIdent(userIdColumn)}::text = $${params.length}::text`);
      }
      const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM ${info.table.sql} s ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      const result = await client.query(
        `
          SELECT
            s.${quoteIdent(idColumn)}::text AS id,
            s.${quoteIdent(tokenHashColumn)}::text AS token_hash,
            ${userIdColumn ? `s.${quoteIdent(userIdColumn)}::text` : "null"} AS admin_id,
            ${adminNameExpr} AS admin_name,
            ${adminEmailExpr} AS admin_email,
            ${ipColumn ? `s.${quoteIdent(ipColumn)}::text` : "null"} AS ip_address,
            ${userAgentColumn ? `s.${quoteIdent(userAgentColumn)}::text` : "null"} AS user_agent,
            ${createdColumn ? `s.${quoteIdent(createdColumn)}::text` : "null"} AS created_at,
            ${lastUsedColumn ? `s.${quoteIdent(lastUsedColumn)}::text` : "null"} AS last_used_at,
            ${expiresColumn ? `s.${quoteIdent(expiresColumn)}::text` : "null"} AS expires_at
          FROM ${info.table.sql} s
          ${joinClause}
          ${whereClause}
          ORDER BY ${lastUsedColumn ? `s.${quoteIdent(lastUsedColumn)} DESC NULLS LAST` : `1 DESC`}
          LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int
        `,
        [...params, limit, offset]
      );

      return {
        total,
        rows: result.rows.map((row) => ({
          id: row.id,
          adminId: row.admin_id,
          adminName: row.admin_name,
          adminEmail: row.admin_email,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          expiresAt: row.expires_at,
          isCurrent: Boolean(currentTokenHash) && row.token_hash === currentTokenHash
        }))
      };
    });

    return NextResponse.json({
      sessions: rows,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat daftar sesi aktif.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const restrictToSelf = !isSuperAdmin(admin);

  const { id } = await request.json().catch(() => ({}));
  if (!id) {
    return NextResponse.json({ error: "id sesi wajib dikirim." }, { status: 400 });
  }

  try {
    const currentTokenHash = await getCurrentSessionTokenHash();

    const revoked = await withClient(async (client) => {
      const info = await getColumns(client, "admin_sessions");
      const idColumn = pickColumn(info.columns, ["id"]);
      const tokenHashColumn = pickColumn(info.columns, ["session_token_hash", "token_hash"]);
      const userIdColumn = pickColumn(info.columns, ["user_id", "userId"]);

      if (!idColumn) {
        throw new Error("Kolom id tidak ditemukan di tabel admin_sessions.");
      }
      if (restrictToSelf && !userIdColumn) {
        throw new Error("Kolom user_id tidak ditemukan di tabel admin_sessions.");
      }

      const whereClauses = [`${quoteIdent(idColumn)}::text = $1::text`];
      const params: string[] = [id];
      if (restrictToSelf && userIdColumn) {
        params.push(admin.id);
        whereClauses.push(`${quoteIdent(userIdColumn)}::text = $2::text`);
      }

      const result = await client.query(
        `
          DELETE FROM ${info.table.sql}
          WHERE ${whereClauses.join(" AND ")}
          RETURNING ${tokenHashColumn ? `${quoteIdent(tokenHashColumn)}::text` : "null"} AS token_hash
        `,
        params
      );

      return result.rows[0] || null;
    });

    if (!revoked) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan (mungkin sudah berakhir, atau bukan milikmu)." },
        { status: 404 }
      );
    }

    const wasCurrentSession = Boolean(currentTokenHash) && revoked.token_hash === currentTokenHash;

    await writeAuditLog({
      request,
      userId: admin.id,
      action: "revoke_admin_session",
      detail: { sessionId: id, wasCurrentSession }
    });

    return NextResponse.json({ ok: true, wasCurrentSession });
  } catch (error) {
    return NextResponse.json(
      { error: formatDbError(error, "Gagal mencabut sesi.") },
      { status: 500 }
    );
  }
}