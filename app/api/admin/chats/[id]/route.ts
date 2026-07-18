import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = params.id;

  try {
    const data = await withClient(async (client) => {
      // 1. Ambil data pesan dengan query paling simpel
      const query = `
        select * from chat_messages 
        where session_id::text = $1::text 
        order by created_at asc
      `;
      const res = await client.query(query, [sessionId]);
      
      // 2. Jika data kosong, jangan crash, kembalikan array kosong
      const rows = res.rows || [];
      const pairs = rows.map(row => ({
        question: row.content || "Tidak ada pertanyaan",
        answer: row.content || "Tidak ada jawaban",
        createdAt: row.created_at || new Date().toISOString(),
        responseTimeMs: 0,
        isFallback: false,
        context: "[]",
        visitorName: "Calon Mahasiswa",
        visitorPhoneNumber: "-",
        visitorSchoolOrigin: "Sekolah Umum"
      }));

      return { pairs, rows };
    });

    return NextResponse.json({
        pairs: data.pairs,
        messages: data.rows
    });

  } catch (error) {
    console.error("DEBUG API CHATS:", error); // Lihat error ini di terminal VPS
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}