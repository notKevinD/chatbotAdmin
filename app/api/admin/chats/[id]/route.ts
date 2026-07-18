import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mengambil ID sesi yang diklik dari parameter URL dinamis Next.js
  const sessionId = params.id;

  try {
    const data = await withClient(async (client) => {
      // 1. Deteksi nama tabel pesan secara adaptif di database Anda
      const msgTableInfo = await getColumns(client, "chat_messages").catch(async () => {
        return await getColumns(client, "messages");
      });

      // 2. Petakan kolom secara otomatis
      const idColumn = pickColumn(msgTableInfo.columns, ["id", "message_id"]);
      const sessionRefColumn = pickColumn(msgTableInfo.columns, ["session_id", "sessionId", "session_ref"]);
      const roleColumn = pickColumn(msgTableInfo.columns, ["role", "sender_type", "sender"]);
      const contentColumn = pickColumn(msgTableInfo.columns, ["content", "message", "text_content", "text"]);
      const createdColumn = pickColumn(msgTableInfo.columns, ["created_at", "createdAt", "timestamp"]);

      if (!sessionRefColumn || !contentColumn) {
        throw new Error("Struktur kolom tabel chat_messages tidak sesuai.");
      }

      // 3. Ambil semua baris pesan obrolan yang memiliki session_id tersebut
      const messagesRes = await client.query(
        `
          select 
            ${idColumn ? `${quoteIdent(idColumn)}::text` : "null"} as id,
            ${quoteIdent(roleColumn || "role")}::text as role,
            ${quoteIdent(contentColumn)}::text as content,
            ${createdColumn ? `${quoteIdent(createdColumn)}::text` : "now()::text"} as created_at
          from ${msgTableInfo.table.sql}
          where ${quoteIdent(sessionRefColumn)}::text = $1::text
          order by ${createdColumn ? quoteIdent(createdColumn) : "1"} asc
        `,
        [sessionId]
      );

      return {
        messages: messagesRes.rows
      };
    });

    return NextResponse.json(data);

  } catch (error) {
    console.error("Error pada API Detail Chats:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat detail isi pesan obrolan.") }, 
      { status: 500 }
    );
  }
}