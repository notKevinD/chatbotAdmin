import { NextResponse } from "next/server";
import { getCurrentAdmin, getCurrentSessionTokenHash } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const currentTokenHash = await getCurrentSessionTokenHash();

    const rows = await withClient(async (client) => {
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
          ${expiresColumn ? `WHERE s.${quoteIdent(expiresColumn)} > now()` : ""}
          ORDER BY ${lastUsedColumn ? `s.${quoteIdent(lastUsedColumn)} DESC NULLS LAST` : `1 DESC`}
        `
      );

      return result.rows.map((row) => ({
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
      }));
    });

    return NextResponse.json({ sessions: rows });
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

      if (!idColumn) {
        throw new Error("Kolom id tidak ditemukan di tabel admin_sessions.");
      }

      const result = await client.query(
        `
          DELETE FROM ${info.table.sql}
          WHERE ${quoteIdent(idColumn)}::text = $1::text
          RETURNING ${tokenHashColumn ? `${quoteIdent(tokenHashColumn)}::text` : "null"} AS token_hash
        `,
        [id]
      );

      return result.rows[0] || null;
    });

    if (!revoked) {
      return NextResponse.json({ error: "Sesi tidak ditemukan (mungkin sudah berakhir)." }, { status: 404 });
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