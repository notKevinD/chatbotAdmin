import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { withClient } from "@/lib/db";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = params.id;

  try {
    const finalPairs = await withClient(async (client) => {
      // Menggunakan nama kolom yang sesuai dengan skema chat_history
      const res = await client.query(
        `SELECT * FROM chat_history WHERE session_id = $1 ORDER BY time_start ASC`,
        [sessionId]
      );
      
      const rows = res.rows || [];
      const pairs = rows.map(row => ({
        question: row.question || "-",
        answer: row.answer || "-",
        createdAt: row.time_start || row.time_end || new Date().toISOString(),
        responseTimeMs: 0, // Kolom ini tidak ada di tabel, gunakan default
        isFallback: row.isfallback || false, // Perhatikan penulisan isfallback
        context: row.context || "[]",
        visitorName: "Calon Mahasiswa",
        visitorPhoneNumber: "-",
        visitorSchoolOrigin: "-"
      }));

      return { pairs, rows };
    });

    return NextResponse.json({
        pairs: finalPairs.pairs,
        messages: finalPairs.rows
    });
  } catch (error) {
    console.error("DEBUG ERROR:", error);
    return NextResponse.json({ error: "Gagal memuat log" }, { status: 500 });
  }
}