import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import { toStoredSqlTimestamp, getTimestampSqlCast } from "@/lib/report-time";

function getFilterFromUrl(urlStr: string) {
  const searchParams = new URL(urlStr).searchParams;
  const requestedRange = searchParams.get("range");
  
  const range = (requestedRange === "today" ||
    requestedRange === "yesterday" ||
    requestedRange === "this_week" ||
    requestedRange === "last_week" ||
    requestedRange === "this_month" ||
    requestedRange === "last_month" ||
    requestedRange === "this_year" ||
    requestedRange === "all" ||
    requestedRange === "custom") ? requestedRange : "today";

  return { range };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.max(1, Number(url.searchParams.get("limit") || 10));
    const search = url.searchParams.get("q")?.trim() || "";

    const filter = getFilterFromUrl(request.url);

    // Jalankan query database untuk mengambil sesi chat Anda di sini
    // ... (Logika kueri SELECT chat_sessions Anda bawaan sebelumnya) ...

    return NextResponse.json({
      sessions: [], // Kembalikan data array sesi riwayat chat dari DB
      pagination: { page, limit, totalRows: 0 }
    });

  } catch (error) {
    console.error("Error pada API chats:", error);
    return NextResponse.json({ error: "Gagal memuat data riwayat percakapan." }, { status: 500 });
  }
}