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

  const sessionId = params.id;

  try {
    // Ambil data array pairs murni dari wrapper database
    const finalPairs = await withClient(async (client) => {
      const msgTableInfo = await getColumns(client, "chat_messages").catch(async () => {
        return await getColumns(client, "messages");
      });

      const idColumn = pickColumn(msgTableInfo.columns, ["id", "message_id"]);
      const sessionRefColumn = pickColumn(msgTableInfo.columns, ["session_id", "sessionId", "session_ref"]);
      const roleColumn = pickColumn(msgTableInfo.columns, ["role", "sender_type", "sender"]);
      const contentColumn = pickColumn(msgTableInfo.columns, ["content", "message", "text_content", "text"]);
      const createdColumn = pickColumn(msgTableInfo.columns, ["created_at", "createdAt", "timestamp"]);
      
      const latencyColumn = pickColumn(msgTableInfo.columns, ["response_time", "latency", "response_time_ms"]);
      const fallbackColumn = pickColumn(msgTableInfo.columns, ["is_fallback", "fallback"]);
      const contextColumn = pickColumn(msgTableInfo.columns, ["context", "sources", "retrieved_context"]);

      let visitorName = "Calon Mahasiswa";
      let visitorPhone = "-";
      let visitorSchool = "Sekolah Umum";

      const chatTableInfo = await getColumns(client, "chat_sessions").catch(() => null);
      if (chatTableInfo) {
        const sIdCol = pickColumn(chatTableInfo.columns, ["id", "session_id", "sessionId"]);
        const sUserCol = pickColumn(chatTableInfo.columns, ["user_id", "user_identifier", "phone", "email", "name"]);
        const sSchoolCol = pickColumn(chatTableInfo.columns, ["school", "school_origin", "visitor_school_origin"]);

        if (sIdCol) {
          const sessionMeta = await client.query(
            `select ${sUserCol ? quoteIdent(sUserCol) : "null"} as name, ${sSchoolCol ? quoteIdent(sSchoolCol) : "null"} as school from ${chatTableInfo.table.sql} where ${quoteIdent(sIdCol)}::text = $1::text limit 1`,
            [sessionId]
          );
          if (sessionMeta.rows.length && sessionMeta.rows[0].name) {
            visitorName = sessionMeta.rows[0].name;
            visitorPhone = sessionMeta.rows[0].name;
            if (sessionMeta.rows[0].school) visitorSchool = sessionMeta.rows[0].school;
          }
        }
      }

      if (!sessionRefColumn || !contentColumn) {
        throw new Error("Struktur kolom tabel pesan obrolan tidak sesuai.");
      }

      const messagesRes = await client.query(
        `
          select 
            ${idColumn ? `${quoteIdent(idColumn)}::text` : "null"} as id,
            ${quoteIdent(roleColumn || "role")}::text as role,
            ${quoteIdent(contentColumn)}::text as content,
            ${latencyColumn ? `${quoteIdent(latencyColumn)}::int` : "null"} as latency,
            ${fallbackColumn ? `${quoteIdent(fallbackColumn)}::boolean` : "false"} as is_fallback,
            ${contextColumn ? `${quoteIdent(contextColumn)}::text` : "null"} as context_raw,
            ${createdColumn ? `${quoteIdent(createdColumn)}::text` : "now()::text"} as created_at
          from ${msgTableInfo.table.sql}
          where ${quoteIdent(sessionRefColumn)}::text = $1::text
          order by ${createdColumn ? quoteIdent(createdColumn) : "1"} asc
        `,
        [sessionId]
      );

      const pairs: any[] = [];
      const rows = messagesRes.rows;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i].role === "user" || rows[i].role === "customer") {
          const nextRow = rows[i + 1];
          const hasBotAnswer = nextRow && (nextRow.role === "assistant" || nextRow.role === "bot" || nextRow.role === "system");

          pairs.push({
            question: rows[i].content,
            answer: hasBotAnswer ? nextRow.content : "Bot tidak merespons.",
            createdAt: rows[i].created_at,
            responseTimeMs: hasBotAnswer && nextRow.latency ? nextRow.latency : 3200,
            isFallback: hasBotAnswer ? nextRow.is_fallback : false,
            context: hasBotAnswer && nextRow.context_raw ? nextRow.context_raw : "[]",
            visitorName,
            visitorPhoneNumber: visitorPhone,
            visitorSchoolOrigin: visitorSchool
          });

          if (hasBotAnswer) i++;
        } else {
          pairs.push({
            question: "Pertanyaan tidak terekam",
            answer: rows[i].content,
            createdAt: rows[i].created_at,
            responseTimeMs: rows[i].latency || 3200,
            isFallback: rows[i].is_fallback || false,
            context: rows[i].context_raw || "[]",
            visitorName,
            visitorPhoneNumber: visitorPhone,
            visitorSchoolOrigin: visitorSchool
          });
        }
      }

      if (pairs.length === 0) {
        pairs.push({
          question: "Tidak ada pesan",
          answer: "Sesi percakapan kosong.",
          createdAt: new Date().toISOString(),
          responseTimeMs: 0,
          isFallback: false,
          context: "[]",
          visitorName,
          visitorPhoneNumber: visitorPhone,
          visitorSchoolOrigin: visitorSchool
        });
      }

      return pairs; // Kembalikan data array mentah ke lingkup luar
    });

    // Kirim respons HTTP JSON murni dari array terluar
    return NextResponse.json(finalPairs);

  } catch (error) {
    console.error("Error pada API Detail Chats:", error);
    return NextResponse.json(
      { error: formatDbError(error, "Gagal memuat detail isi pesan obrolan.") }, 
      { status: 500 }
    );
  }
}