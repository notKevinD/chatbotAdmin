import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { withClient } from "@/lib/db";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = params.id;
  if (!sessionId) {
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });
  }

  try {
    const result = await withClient(async (client) => {
      const table = "chat_history";
      const idCol = "session_id";
      const visitorNameCol = "visitor_name";
      const phoneCol = "visitor_phone";
      const schoolCol = "school_origin";
      const questionCol = "question";
      const answerCol = "answer";
      const timeStartCol = "time_start";
      const timeEndCol = "time_end";
      const isFallbackCol = "isfallback";
      const contextCol = "context";

      const query = `
        SELECT 
          ${questionCol} AS question,
          ${answerCol} AS answer,
          ${timeStartCol} AS "createdAt",
          ${timeEndCol} AS "timeEnd",
          ${isFallbackCol} AS "isFallback",
          ${contextCol} AS context,
          ${visitorNameCol} AS "visitorName",
          ${phoneCol} AS "visitorPhoneNumber",
          ${schoolCol} AS "visitorSchoolOrigin"
        FROM ${table}
        WHERE ${idCol} = $1
        ORDER BY ${timeStartCol} ASC
      `;
      const res = await client.query(query, [sessionId]);
      const rows = res.rows || [];

      const pairs = rows.map((row) => {
        let responseTimeMs = 0;
        if (row.createdAt && row.timeEnd) {
          const start = new Date(row.createdAt).getTime();
          const end = new Date(row.timeEnd).getTime();
          responseTimeMs = Math.max(0, end - start);
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

      const leadInfo = pairs.length > 0 ? {
        visitorName: pairs[0].visitorName,
        visitorPhoneNumber: pairs[0].visitorPhoneNumber,
        visitorSchoolOrigin: pairs[0].visitorSchoolOrigin,
      } : {
        visitorName: "Calon Mahasiswa",
        visitorPhoneNumber: "-",
        visitorSchoolOrigin: "-",
      };

      return { pairs, leadInfo };
    });

    return NextResponse.json({
      pairs: result.pairs,
      leadInfo: result.leadInfo,
      messages: result.pairs, // kompatibilitas
    });
  } catch (error) {
    console.error("Error detail chat:", error);
    return NextResponse.json(
      { error: "Gagal memuat detail percakapan" },
      { status: 500 }
    );
  }
}