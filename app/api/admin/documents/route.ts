import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { formatDbError, getColumns, pickColumn, quoteIdent, withClient } from "@/lib/db";
import * as XLSX from "xlsx";
import crypto from "crypto";

export async function GET(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const metadataName = url.searchParams.get("file")?.trim();

  if (!metadataName) {
    return NextResponse.json({ error: "Parameter file diperlukan" }, { status: 400 });
  }

  try {
    const excelBuffer = await withClient(async (client) => {
      const docInfo = await getColumns(client, "documents");
      const metadataSourceColumn = pickColumn(docInfo.columns, ["metadata_source", "metadataSource"]);
      const metadataColumn = pickColumn(docInfo.columns, ["metadata"]);
      const previewColumn = pickColumn(docInfo.columns, ["preview", "content"]);
      const rawColumn = pickColumn(docInfo.columns, ["raw", "data"]);
      const idColumn = pickColumn(docInfo.columns, ["id"]);

      if (!rawColumn) throw new Error("Struktur tabel documents tidak sesuai.");

      const conditions: string[] = [];
      if (metadataSourceColumn) conditions.push(`lower(${quoteIdent(metadataSourceColumn)}::text) = lower($1::text)`);
      if (metadataColumn) {
        const meta = quoteIdent(metadataColumn);
        conditions.push(`lower(${meta}->>'source') = lower($1::text)`);
        conditions.push(`lower(${meta}->>'metadata_name') = lower($1::text)`);
      }

      const result = await client.query<{ id: string; preview: string; raw: any }>(
        `select 
            ${idColumn ? quoteIdent(idColumn) : "null"} as id,
            ${previewColumn ? quoteIdent(previewColumn) : "null"} as preview,
            ${quoteIdent(rawColumn)} as raw
         from ${docInfo.table.sql}
         where ${conditions.length ? conditions.join(" or ") : "1=0"}
         order by id asc`,
        [metadataName]
      );

      const sheetsData: Record<string, any[]> = {};
      result.rows.forEach((row) => {
        const rawMeta = typeof row.raw === "string" ? JSON.parse(row.raw) : row.raw;
        const sheetName = rawMeta?.sheet || "Sheet1";
        const textContent = String(rawMeta?.text || row.preview || "");

        const qMatch = textContent.match(/Pertanyaan:\s*([\s\S]*?)(?=\nJawaban:|$)/);
        const aMatch = textContent.match(/Jawaban:\s*([\s\S]*)/);
        const question = qMatch ? qMatch[1].trim() : textContent;
        const answer = aMatch ? aMatch[1].trim() : "";

        if (!sheetsData[sheetName]) sheetsData[sheetName] = [];
        sheetsData[sheetName].push({ "No. Baris Asal": rawMeta?.row || "", "Pertanyaan": question, "Jawaban": answer });
      });

      const workbook = XLSX.utils.book_new();
      Object.entries(sheetsData).forEach(([sheetName, rows]) => {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 15 }, { wch: 60 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
      });

      return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    });

    return new NextResponse(new Uint8Array(excelBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(metadataName)}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error, "Gagal mengekspor berkas.") }, { status: 500 });
  }
}

// ... Sertakan juga fungsi POST, PUT, DELETE di dalam file documents/route.ts ini seperti kode lengkap sebelumnya ...