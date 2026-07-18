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
      // chat_history tidak menyimpan data visitor secara langsung.
      // Relasinya: chat_history.session_id -> chat_sessions.session_id
      //            chat_sessions.visitors_id -> visitors.visitor_uuid
      const questionCol = "h.question";
      const answerCol = "h.answer";
      const timeStartCol = "h.time_start";
      const timeEndCol = "h.time_end";
      const isFallbackCol = "h.isfallback";
      const contextCol = "h.context";
      const visitorNameCol = "v.visitors_name";
      const phoneCol = "v.visitors_phone_number";
      const schoolCol = "v.visitor_school_origin";

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
        FROM chat_history h
        LEFT JOIN chat_sessions cs ON cs.session_id = h.session_id
        LEFT JOIN visitors v ON v.visitor_uuid = cs.visitors_id
        WHERE h.session_id = $1
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